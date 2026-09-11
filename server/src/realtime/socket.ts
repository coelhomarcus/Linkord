import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config/env.js';
import {
  participants as participantsMap, join, send, broadcast, publicParticipant, handleClose, ipOf,
  listOnlineUserIds, setCallConversationId, handlers as participantHandlers,
} from './participants.js';
import * as livekit from './livekit.js';
import * as reactions from './reactions.js';
import * as floodControl from './floodControl.js';
import * as chat from '../modules/chat.js';
import * as conversations from '../modules/conversations.js';
import * as attachments from '../modules/attachments.js';
import * as discordWebhook from '../modules/discordWebhook.js';
import * as moderation from '../modules/moderation.js';
import { listAllUsers } from '../modules/auth/users.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from '../modules/auth/session.js';
import type { AppSocket, HandlerTable } from '../types.js';

// {message type: handler(socket, msg)} combining what each feature exports
// — register a new feature's `handlers` here, no dispatch changes needed.
// 'join' is special-cased (see handleJoin) because welcome needs data from
// several features.
const handlers: HandlerTable = Object.assign(
  {},
  participantHandlers,
  reactions.handlers,
  chat.handlers,
  conversations.handlers,
  discordWebhook.handlers,
  moderation.handlers,
);

interface JoinMessage {
  id?: string;
  token?: string;
}

// Per-account sliding-window caps for the events an authenticated account
// (or a script driving it) could otherwise flood at unlimited speed — chat
// writes/broadcasts, reactions, and profile updates all hit the DB and fan
// out to every connected participant with no other throttle in front of
// them. Not applied to every event on purpose: most read-only/idempotent
// ones (conversation-open, call-join, mic-state, ...) aren't the same kind of
// risk and a limiter here would just make normal UI usage flaky.
// 'message-search' is the one read-only exception — it's a full-text query
// against the DB on every call, so it gets a conservative cap as defense in
// depth against a scripted client bypassing the search box's own debounce;
// 'load-messages-around' stays unthrottled like the other reads since it's
// click-driven, not keystroke-driven.
const ACTION_LIMITS: Record<string, { windowMs: number; max: number }> = {
  chat: { windowMs: 10_000, max: 10 },
  'chat-edit': { windowMs: 10_000, max: 10 },
  'chat-delete': { windowMs: 10_000, max: 10 },
  'chat-react': { windowMs: 10_000, max: 20 },
  reaction: { windowMs: 10_000, max: 20 },
  profile: { windowMs: 60_000, max: 10 },
  'message-search': { windowMs: 10_000, max: 20 },
};

/** 'join' is the one special case in the dispatch: only participants.ts
 * creates/finds the participant, but the `welcome` reply also carries chat
 * history and the LiveKit token — data from other features. Lives here
 * (the composition root) so no feature depends on another. */
async function handleJoin(socket: AppSocket, msg: JoinMessage): Promise<void> {
  const p = join(socket, msg);
  if (!p) return;
  // LiveKit token is NOT minted here anymore — just having the tab open/
  // logged in shouldn't open a real call session. That now only happens
  // in handleCallJoin, when someone joins a group call.
  send(socket, {
    t: 'welcome',
    id: p.id,
    token: p.token,
    userId: p.userId,
    name: p.name,
    displayName: p.displayName,
    avatar: p.avatar,
    avatarColor: p.avatarColor,
    banner: p.banner,
    bio: p.bio,
    profileLinks: p.profileLinks,
    role: p.role,
    maxParticipants: config.MAX_PARTICIPANTS,
    participants: [...participantsMap.values()].filter((o) => o.id !== p.id).map(publicParticipant),
    conversations: await conversations.listForUser(p.userId),
    users: await listAllUsers(),
    onlineUserIds: listOnlineUserIds(),
    storageUsage: await attachments.getUsage(),
    livekitUrl: config.LIVEKIT_URL,
  });
  broadcast({ t: 'participant-joined', participant: publicParticipant(p) }, p.id);
  console.log(`[${p.id}] entrou (${p.name}) de ${socket.ip}`);
}

/** Actually joins a call (group or 1:1 direct): mints a LiveKit token for
 * that conversation's room (`${LIVEKIT_ROOM_NAME}-${conversationId}`) and
 * sets `p.callConversationId`. Rejected if the caller isn't a member of
 * that conversation at all. */
async function handleCallJoin(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const conversation = await conversations.getConversationForUser(conversationId, p.userId);
  if (!conversation) {
    send(socket, { t: 'error', code: 'call-not-allowed', message: 'Voce nao tem acesso a essa conversa.' });
    return;
  }
  let livekitToken: string;
  try {
    livekitToken = await livekit.createToken(p, `${config.LIVEKIT_ROOM_NAME}-${conversationId}`);
  } catch (err) {
    console.warn(`[${p.id}] falha ao gerar token do LiveKit: ${err instanceof Error ? err.message : err}`);
    send(socket, { t: 'error', code: 'livekit-unavailable', message: 'Video/voz indisponivel no momento.' });
    return;
  }
  setCallConversationId(p, conversationId);
  send(socket, { t: 'call-token', conversationId, livekitUrl: config.LIVEKIT_URL, livekitToken });
}

function handleCallLeave(socket: AppSocket): void {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  setCallConversationId(p, null);
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
      });
    }
  } catch (err) {
    console.error(`[ws] erro no handler '${eventName}' (participantId=${socket.participantId}): ${err instanceof Error ? err.stack : err}`);
  }
}

export function createWsServer(httpServer: HttpServer): Server {
  // transports:['websocket'] kept for simplicity (one less fallback to
  // test) — now that camera/screen go over WebRTC, there's no strong
  // technical reason for it (the socket only carries small signaling).
  const io = new Server(httpServer, {
    path: '/ws',
    transports: ['websocket'],
    maxHttpBufferSize: config.MAX_MSG_BYTES,
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

    socket.onAny((eventName: string, payload: unknown) => {
      if (eventName === 'join') return safeHandle('join', socket, payload || {}, (s, p) => handleJoin(s, (p || {}) as JoinMessage));
      if (eventName === 'ping') return safeHandle('ping', socket, payload || {}, (s) => send(s, { t: 'pong' }));
      if (eventName === 'call-join') {
        return safeHandle(eventName, socket, payload || {}, (s, m) => handleCallJoin(s, (m || {}) as { conversationId?: string }));
      }
      if (eventName === 'call-leave') return safeHandle(eventName, socket, payload || {}, (s) => handleCallLeave(s));

      const handler = handlers[eventName];
      if (!handler) return;

      const rule = ACTION_LIMITS[eventName];
      if (rule) {
        const userId = participantsMap.get(socket.participantId ?? '')?.userId;
        // no participant yet (never joined) — the handler's own `p.socket
        // !== socket` guard already no-ops it, nothing to rate-limit.
        if (userId && !floodControl.allow(`${eventName}:${userId}`, rule)) {
          send(socket, { t: 'error', code: 'rate_limited', message: 'Voce esta enviando rapido demais. Espere um pouco.' });
          return;
        }
      }
      safeHandle(eventName, socket, payload || {}, handler);
    });

    socket.on('disconnect', () => handleClose(socket));
  });

  return io;
}
