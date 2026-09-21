import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { findById } from '../users/users.js';
import { blockUser, unblockUser, listBlocks } from './blocksRepository.js';
import { onSocialChange } from '../presence/knownPeers.js';
import { announceRevocations } from '../conversations/invitationsRepository.js';
import { revokeDirectCallAccess } from '../calls/callAccess.js';

type Params = { userId: string };

async function handleBlock(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  if (!targetId || targetId === sess.userId || !(await findById(targetId))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  const revokedIds = await blockUser(sess.userId, targetId);
  sendJson(reply, 200, { blocked: true });
  void onSocialChange(sess.userId, targetId);
  void announceRevocations(revokedIds);
  void revokeDirectCallAccess(sess.userId, targetId);
}

async function handleUnblock(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  if (!targetId) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  await unblockUser(sess.userId, targetId);
  sendJson(reply, 200, { blocked: false });
  void onSocialChange(sess.userId, targetId);
}

async function handleListBlocks(request: FastifyRequest<{ Querystring: { cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const page = await listBlocks(sess.userId, request.query.cursor);
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

export function registerBlockRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/blocks', handleListBlocks);
  fastify.post('/api/blocks/:userId', handleBlock);
  fastify.delete('/api/blocks/:userId', handleUnblock);
}
