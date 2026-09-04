import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config/env.js';
import {
  participants as participantsMap, join, send, broadcast, publicParticipant, handleClose, ipOf,
  listOnlineUserIds, handlers as participantHandlers,
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
import type { AppSocket, HandlerTable } from '../types.js';

// Tabela {tipo da mensagem: handler(socket, msg)} juntando o que cada feature
// exporta — adicionar uma feature nova e so registrar seus `handlers` aqui,
// sem mexer no dispatch abaixo. 'join' fica de fora de proposito (ver
// handleJoin) porque o welcome precisa juntar dado de varias features.
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

/** 'join' e o unico caso especial do dispatch: so participants.ts sabe criar/
 * achar o participante, mas o `welcome` que a resposta manda tambem carrega
 * o historico do chat e o token do LiveKit — dados de outras features. Fica
 * aqui (na raiz de composicao) pra nenhuma feature depender de outra. */
async function handleJoin(socket: AppSocket, msg: JoinMessage): Promise<void> {
  const p = join(socket, msg);
  if (!p) return;
  // chat/presenca nao devem cair junto se o LiveKit estiver mal configurado
  // (aviso ja sai no boot, ver src/index.ts) — welcome vai com livekitToken
  // null e o cliente so fica sem video nesse caso.
  let livekitToken: string | null = null;
  try {
    livekitToken = await livekit.createToken(p);
  } catch (err) {
    console.warn(`[${p.id}] falha ao gerar token do LiveKit: ${err instanceof Error ? err.message : err}`);
  }
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
    livekitToken,
    livekitUrl: config.LIVEKIT_URL,
    livekitRoomName: config.LIVEKIT_ROOM_NAME,
  });
  broadcast({ t: 'participant-joined', participant: publicParticipant(p) }, p.id);
  console.log(`[${p.id}] entrou (${p.name}) de ${socket.ip}`);
}

/** Roda um handler (sincrono ou async) isolado de erro — sem isso, uma
 * excecao ou promise rejeitada de qualquer handler de qualquer feature
 * derruba o processo inteiro (Node mata o processo em unhandledRejection por
 * padrao), desconectando todo mundo na sala por um bug de uma unica
 * mensagem de um unico participante. */
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
  // transports:['websocket'] mantido por simplicidade (menos um fallback pra
  // testar) — agora que camera/tela vao por WebRTC, nao ha mais motivo tecnico
  // forte pra isso (o WebSocket so carrega sinalizacao pequena).
  const io = new Server(httpServer, {
    path: '/ws',
    transports: ['websocket'],
    maxHttpBufferSize: config.MAX_MSG_BYTES,
  });

  // Nunca existe socket anonimo: o handshake (upgrade HTTP) carrega o cookie
  // normalmente, entao a sessao ja e resolvida ANTES de 'connection' disparar.
  // Uma rejeicao aqui mata o socket sem reconectar (socket.active vira false
  // no cliente) — RoomProvider usa isso pra cair de volta na tela de login.
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

      const handler = handlers[eventName];
      if (handler) safeHandle(eventName, socket, payload || {}, handler);
    });

    socket.on('disconnect', () => handleClose(socket));
  });

  return io;
}
