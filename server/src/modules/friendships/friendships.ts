import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { errorBody } from '../../http/errors.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import * as floodControl from '../../realtime/floodControl.js';
import {
  requestFriendship, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriendship,
  listFriends, listFriendRequests, countIncomingRequests, getRelationship,
  type FriendshipResult,
} from './friendshipsRepository.js';
import { normalizeSearchQuery } from './cursor.js';
import { onSocialChange } from '../presence/knownPeers.js';
import { announceRevocations, countReceivedInvitations } from '../conversations/invitationsRepository.js';
import { revokeDirectCallAccess } from '../calls/callAccess.js';
import type { Friendship } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'friendships' });

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
      return sendJson(reply, 409, errorBody('cooldown', 'Espere antes de tentar novamente.', { retryAfter: result.retryAfter.toISOString() }));
    case 'user_unavailable': return sendError(reply, 404, 'user_unavailable', 'Não foi possível enviar a solicitação.');
    case 'not_found': return sendError(reply, 404, 'not_found', 'Solicitação não encontrada.');
    case 'forbidden': return sendError(reply, 403, 'forbidden', 'Você não pode fazer isso.');
    case 'invalid_state': return sendError(reply, 409, 'conflict', 'Essa solicitação não está mais nesse estado.');
    case 'quota_exceeded': log.info('friendship action blocked by a quota', { quota: result.quota }); return sendJson(reply, 409, errorBody('quota_exceeded', result.quota === 'friends' ? 'Limite de amigos atingido.' : 'Você tem solicitações pendentes demais.', { quota: result.quota }));
  }
}

const STATE_CHANGING = new Set<FriendshipResult['code']>(['created', 'accepted', 'declined', 'cancelled', 'removed']);

/** Fire-and-forget on purpose: the mutation already committed, and
 * onSocialChange never throws — the caller shouldn't wait on a push to other
 * tabs/accounts to get its own HTTP answer. */
function afterMutation(me: string, other: string, result: FriendshipResult): void {
  if (STATE_CHANGING.has(result.code)) void onSocialChange(me, other);
  if (result.code === 'removed') {
    if (result.revokedInvitationIds?.length) void announceRevocations(result.revokedInvitationIds);
    void revokeDirectCallAccess(me, other);
  }
}

const otherSideOf = (f: Friendship, me: string): string => (f.userLowId === me ? f.userHighId : f.userLowId);

async function handleCreate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`friend-request:${sess.userId}`, { windowMs: 60_000, max: 5 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está enviando solicitações rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const username = String(body.username || '').trim();
  if (!username) return sendError(reply, 400, 'invalid_username', 'Informe um nome de usuário.');
  const result = await requestFriendship(sess.userId, username);
  respond(reply, result);
  if (result.code === 'created') afterMutation(sess.userId, otherSideOf(result.friendship, sess.userId), result);
}

async function handleAccept(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const otherId = String(request.params.userId || '');
  const result = await acceptFriendRequest(sess.userId, otherId);
  respond(reply, result);
  afterMutation(sess.userId, otherId, result);
}

async function handleDecline(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const otherId = String(request.params.userId || '');
  const result = await declineFriendRequest(sess.userId, otherId);
  respond(reply, result);
  afterMutation(sess.userId, otherId, result);
}

async function handleCancel(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const otherId = String(request.params.userId || '');
  const result = await cancelFriendRequest(sess.userId, otherId);
  respond(reply, result);
  afterMutation(sess.userId, otherId, result);
}

async function handleRemove(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const otherId = String(request.params.userId || '');
  const result = await removeFriendship(sess.userId, otherId);
  respond(reply, result);
  afterMutation(sess.userId, otherId, result);
}

async function handleListFriends(request: FastifyRequest<{ Querystring: { cursor?: string; q?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const page = await listFriends(sess.userId, { cursor: request.query.cursor, q: normalizeSearchQuery(request.query.q) || undefined });
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleListRequests(request: FastifyRequest<{ Querystring: { direction?: string; cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const { direction, cursor } = request.query;
  if (direction !== 'incoming' && direction !== 'outgoing') {
    return sendError(reply, 400, 'invalid_direction', 'Direção inválida.');
  }
  const page = await listFriendRequests(sess.userId, direction, cursor);
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleRequestSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  // `incoming` = friend requests, `invitations` = group invitations — both
  // wait on the caller's answer and both feed the sidebar badge
  const [incoming, invitations] = await Promise.all([countIncomingRequests(sess.userId), countReceivedInvitations(sess.userId)]);
  sendJson(reply, 200, { incoming, invitations });
}

async function handleRelationship(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  sendJson(reply, 200, await getRelationship(sess.userId, String(request.params.userId || '')));
}

export function registerFriendshipRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/friends', handleListFriends);
  fastify.get('/api/friend-requests', handleListRequests);
  fastify.get('/api/friend-requests/summary', handleRequestSummary);
  fastify.get('/api/relationships/:userId', handleRelationship);
  fastify.post('/api/friend-requests', handleCreate);
  fastify.post('/api/friend-requests/:userId/accept', handleAccept);
  fastify.post('/api/friend-requests/:userId/decline', handleDecline);
  fastify.post('/api/friend-requests/:userId/cancel', handleCancel);
  fastify.delete('/api/friendships/:userId', handleRemove);
}
