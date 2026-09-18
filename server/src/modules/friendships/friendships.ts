import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import * as floodControl from '../../realtime/floodControl.js';
import {
  requestFriendship, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriendship,
  type FriendshipResult,
} from './friendshipsRepository.js';

type Params = { userId: string };

async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) {
    sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    return null;
  }
  return sess;
}

/** Maps the repository's outcome to an HTTP response — the repository stays
 * transport-agnostic (a future socket/admin caller could reuse it), only
 * this module knows about status codes. */
function respond(reply: FastifyReply, result: FriendshipResult): void {
  switch (result.code) {
    case 'created': return sendJson(reply, 201, { friendship: result.friendship });
    case 'already_friends': return sendJson(reply, 200, { friendship: result.friendship });
    case 'already_pending': return sendJson(reply, 200, { friendship: result.friendship, direction: result.direction });
    case 'pending_received': return sendJson(reply, 200, { friendship: result.friendship, direction: result.direction });
    case 'accepted': return sendJson(reply, 200, { friendship: result.friendship });
    case 'declined': return sendJson(reply, 200, { friendship: result.friendship });
    case 'cancelled': return sendJson(reply, 200, { friendship: result.friendship });
    case 'removed': return sendJson(reply, 200, { friendship: result.friendship });
    case 'cooldown':
      return sendJson(reply, 409, { error: { code: 'cooldown', message: 'Espere antes de tentar novamente.', retryAfter: result.retryAfter.toISOString() } });
    case 'user_unavailable': return sendError(reply, 404, 'user_unavailable', 'Não foi possível enviar a solicitação.');
    case 'not_found': return sendError(reply, 404, 'not_found', 'Solicitação não encontrada.');
    case 'forbidden': return sendError(reply, 403, 'forbidden', 'Você não pode fazer isso.');
    case 'invalid_state': return sendError(reply, 409, 'conflict', 'Essa solicitação não está mais nesse estado.');
  }
}

async function handleCreate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`friend-request:${sess.userId}`, { windowMs: 60_000, max: 5 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está enviando solicitações rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const username = String(body.username || '').trim();
  if (!username) return sendError(reply, 400, 'invalid_username', 'Informe um nome de usuário.');
  respond(reply, await requestFriendship(sess.userId, username));
}

async function handleAccept(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respond(reply, await acceptFriendRequest(sess.userId, String(request.params.userId || '')));
}

async function handleDecline(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respond(reply, await declineFriendRequest(sess.userId, String(request.params.userId || '')));
}

async function handleCancel(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respond(reply, await cancelFriendRequest(sess.userId, String(request.params.userId || '')));
}

async function handleRemove(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respond(reply, await removeFriendship(sess.userId, String(request.params.userId || '')));
}

export function registerFriendshipRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/friend-requests', handleCreate);
  fastify.post('/api/friend-requests/:userId/accept', handleAccept);
  fastify.post('/api/friend-requests/:userId/decline', handleDecline);
  fastify.post('/api/friend-requests/:userId/cancel', handleCancel);
  fastify.delete('/api/friendships/:userId', handleRemove);
}
