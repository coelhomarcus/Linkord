import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { findById, publicUser } from './users.js';
import { areFriends } from '../friendships/friendshipsRepository.js';
import { shareAnyConversation } from '../conversations/conversationsRepository.js';

type Params = { userId: string };

/** §4.2.6 of the plan: knowing an id never grants access on its own — self,
 * an admin, a friend, or a shared conversation all do. Only used here (not
 * exported): the composition happens at this route-handler layer on
 * purpose, the same way realtime/socket.ts composes across domains,
 * instead of adding a users→friendships/conversations edge that would
 * cycle back (friendshipsRepository already imports users.js). */
async function canViewProfile(viewerId: string, viewerRole: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId || viewerRole === 'admin') return true;
  if (await areFriends(viewerId, targetId)) return true;
  return shareAnyConversation(viewerId, targetId);
}

/** `GET /api/users/:userId/profile` — the "perfil sob demanda" fetch for
 * when a profile isn't already in the client's known-users cache (e.g. the
 * author of an old message who has since left the group). Denial and
 * "doesn't exist" return the exact same 404 — same posture as
 * friendships.ts's `user_unavailable`, never confirm/deny based on a
 * relationship the caller doesn't already have. */
async function handleGetProfile(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  const target = targetId ? await findById(targetId) : null;
  if (!target || !(await canViewProfile(sess.userId, sess.role, target.id))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  sendJson(reply, 200, { user: publicUser(target) });
}

export function registerUserRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/users/:userId/profile', handleGetProfile);
}
