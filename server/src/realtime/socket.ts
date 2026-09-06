import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config/env.js';
import {
  participants as participantsMap, join, send, broadcast, publicParticipant, handleClose, ipOf,
  listOnlineUserIds, setVoiceChannelId, handlers as participantHandlers,
} from './participants.js';
import * as livekit from './livekit.js';
import * as reactions from './reactions.js';
import * as chat from '../modules/chat.js';
import * as channels from '../modules/channels.js';
import * as attachments from '../modules/attachments.js';
import * as discordWebhook from '../modules/discordWebhook.js';
import * as moderation from '../modules/moderation.js';
import { listAllUsers } from '../modules/auth/users.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from '../modules/auth/session.js';
import { consumeWsEvent } from './rateLimit.js';
import type { AppSocket, HandlerTable } from '../types.js';

const JOIN_TIMEOUT_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

// {message type: handler(socket, msg)} combining what each feature exports
// — register a new feature's `handlers` here, no dispatch changes needed.
// 'join' is special-cased (see handleJoin) because welcome needs data from
// several features.
const handlers: HandlerTable = Object.assign(
  {},
  participantHandlers,
  reactions.handlers,
  chat.handlers,
  channels.handlers,
  discordWebhook.handlers,
  moderation.handlers,
);

interface JoinMessage {
  id?: string;
  token?: string;
}

/** 'join' is the one special case in the dispatch: only participants.ts
 * creates/finds the participant, but the `welcome` reply also carries chat
 * history and the LiveKit token — data from other features. Lives here
 * (the composition root) so no feature depends on another. */
async function handleJoin(socket: AppSocket, msg: JoinMessage): Promise<void> {
  const p = join(socket, msg);
  if (!p) return;
  // LiveKit token is NOT minted here anymore — just having the tab open/
  // logged in shouldn't open a real voice session. That now only happens
  // in handleVoiceJoin, when someone actually clicks a voice channel.
  send(socket, {
    t: 'welcome',
    id: p.id,
    token: p.token,
    userId: p.userId,
    name: p.name,
    avatar: p.avatar,
    role: p.role,
    maxParticipants: config.MAX_PARTICIPANTS,
    participants: [...participantsMap.values()].filter((o) => o.id !== p.id).map(publicParticipant),
    categories: await channels.listTree(),
    users: await listAllUsers(),
    onlineUserIds: listOnlineUserIds(),
    storageUsage: await attachments.getUsage(),
    livekitUrl: config.LIVEKIT_URL,
  });
  broadcast({ t: 'participant-joined', participant: publicParticipant(p) }, p.id);
  console.log(`[${p.id}] entrou (${p.name}) de ${socket.ip}`);
}

/** Actually joins a specific voice channel: mints a LiveKit token for that
 * channel's room (`${LIVEKIT_ROOM_NAME}-${channelId}`, one room per voice
 * channel) and sets `p.voiceChannelId` — only now (not in handleJoin), so a
 * real voice session opens only when someone actually clicks a voice
 * channel. Switching channels just calls this again; the client
 * disconnects the old Room before connecting to the new one. */
async function handleVoiceJoin(socket: AppSocket, msg: { channelId?: string }): Promise<void> {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  if (!channelId) {
    send(socket, { t: 'error', code: 'invalid-channel', message: 'Canal de voz invalido.' });
    return;
  }
  if (channels.isChannelBeingDeleted(channelId)) {
    send(socket, { t: 'error', code: 'invalid-channel', message: 'Esse canal de voz esta sendo apagado.' });
    return;
  }
  const type = await channels.getChannelType(channelId);
  if (type !== 'voice' || channels.isChannelBeingDeleted(channelId)) {
    send(socket, { t: 'error', code: 'invalid-channel', message: 'Canal de voz invalido.' });
    return;
  }
  let livekitToken: string;
  try {
    livekitToken = await livekit.createToken(p, livekit.voiceRoomName(channelId));
  } catch (err) {
    console.warn(`[${p.id}] falha ao gerar token do LiveKit: ${err instanceof Error ? err.message : err}`);
    send(socket, { t: 'error', code: 'livekit-unavailable', message: 'Video/voz indisponivel no momento.' });
    return;
  }
  // Token creation is asynchronous. Re-check both the marker and the row so
  // a deletion that completed during signing cannot publish a stale token or
  // restore in-memory presence to the removed channel.
  const currentType = await channels.getChannelType(channelId);
  if (currentType !== 'voice' || channels.isChannelBeingDeleted(channelId)) {
    send(socket, { t: 'error', code: 'invalid-channel', message: 'Esse canal de voz nao esta mais disponivel.' });
    return;
  }
  setVoiceChannelId(p, channelId);
  send(socket, { t: 'voice-token', channelId, livekitUrl: config.LIVEKIT_URL, livekitToken });
}

function handleVoiceLeave(socket: AppSocket): void {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  setVoiceChannelId(p, null);
}

/** Runs a handler (sync or async) isolated from errors — otherwise an
 * exception or rejected promise from any feature's handler kills the whole
 * process (Node exits on unhandledRejection by default), disconnecting the
 * entire room over one participant's one bad message. */
function safeHandle(eventName: string, socket: AppSocket, payload: unknown, handler: (socket: AppSocket, payload: unknown) => unknown): void {
  try {
    const result = handler(socket, payload);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch((err: unknown) => {
        console.error(`[ws] erro no handler '${eventName}' (participantId=${socket.participantId}): ${err instanceof Error ? err.stack : err}`);
        send(socket, { t: 'error', code: 'internal-error', message: 'Nao foi possivel concluir essa acao.' });
      });
    }
  } catch (err) {
    console.error(`[ws] erro no handler '${eventName}' (participantId=${socket.participantId}): ${err instanceof Error ? err.stack : err}`);
    send(socket, { t: 'error', code: 'internal-error', message: 'Nao foi possivel concluir essa acao.' });
  }
}

function scheduleSessionExpiry(socket: AppSocket): void {
  const remaining = socket.user.expiresAtMs - Date.now();
  if (remaining <= 0) {
    send(socket, { t: 'error', code: 'session-expired', message: 'Sua sessao expirou. Entre novamente.' });
    socket.disconnect(true);
    return;
  }
  socket.sessionExpiryTimer = setTimeout(() => scheduleSessionExpiry(socket), Math.min(remaining, MAX_TIMER_DELAY_MS));
  socket.sessionExpiryTimer.unref();
}

function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // non-browser clients still need a valid session cookie
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function createWsServer(httpServer: HttpServer): Server {
  // transports:['websocket'] kept for simplicity (one less fallback to
  // test) — now that camera/screen go over WebRTC, there's no strong
  // technical reason for it (the socket only carries small signaling).
  const io = new Server(httpServer, {
    path: '/ws',
    transports: ['websocket'],
    maxHttpBufferSize: config.MAX_MSG_BYTES,
    // Browsers always send Origin on the WebSocket handshake. Refuse a
    // different host to prevent another site from driving an authenticated
    // Linkord socket with the victim's cookies.
    allowRequest(req, callback) {
      callback(null, isSameOrigin(req.headers.origin, req.headers.host));
    },
  });

  // no anonymous socket ever exists: the handshake carries the cookie, so
  // the session is resolved BEFORE 'connection' fires. A rejection here
  // kills the socket without reconnecting (socket.active becomes false
  // client-side) — RoomProvider uses that to fall back to the login screen.
  io.use(async (socket: Socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
      if (!sess) return next(Object.assign(new Error('Sessao invalida ou expirada.'), { data: { code: 'unauthorized' } }));
      (socket as AppSocket).user = sess;
      next();
    } catch {
      next(Object.assign(new Error('Erro de autenticacao.'), { data: { code: 'auth_error' } }));
    }
  });

  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AppSocket;
    socket.participantId = null;
    socket.ip = ipOf(socket);
    scheduleSessionExpiry(socket);

    const joinTimer = setTimeout(() => {
      if (socket.connected && !socket.participantId) {
        send(socket, { t: 'error', code: 'join-timeout', message: 'A conexao nao concluiu a entrada na sala.' });
        socket.disconnect(true);
      }
    }, JOIN_TIMEOUT_MS);
    joinTimer.unref();

    socket.onAny((eventName: string, payload: unknown) => {
      const retryAfterSec = consumeWsEvent(socket.user.userId, eventName);
      if (retryAfterSec) {
        send(socket, { t: 'error', code: 'rate-limited', message: `Muitas acoes. Tente novamente em ${retryAfterSec}s.` });
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        send(socket, { t: 'error', code: 'invalid-payload', message: 'Dados da acao invalidos.' });
        return;
      }
      if (!socket.participantId && eventName !== 'join' && eventName !== 'ping') {
        send(socket, { t: 'error', code: 'join-required', message: 'Entre na sala antes de executar essa acao.' });
        return;
      }
      if (eventName === 'join') return safeHandle('join', socket, payload || {}, (s, p) => handleJoin(s, (p || {}) as JoinMessage));
      if (eventName === 'ping') return safeHandle('ping', socket, payload || {}, (s) => send(s, { t: 'pong' }));
      if (eventName === 'voice-join') return safeHandle('voice-join', socket, payload || {}, (s, m) => handleVoiceJoin(s, (m || {}) as { channelId?: string }));
      if (eventName === 'voice-leave') return safeHandle('voice-leave', socket, payload || {}, (s) => handleVoiceLeave(s));

      const handler = handlers[eventName];
      if (handler) safeHandle(eventName, socket, payload || {}, handler);
      else send(socket, { t: 'error', code: 'unsupported-event', message: 'Acao nao suportada.' });
    });

    socket.on('disconnect', () => {
      clearTimeout(joinTimer);
      if (socket.sessionExpiryTimer) clearTimeout(socket.sessionExpiryTimer);
      handleClose(socket);
    });
  });

  return io;
}
