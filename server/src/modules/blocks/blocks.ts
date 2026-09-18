import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { findById } from '../users/users.js';
import { blockUser, unblockUser } from './blocksRepository.js';

type Params = { userId: string };

async function handleBlock(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  if (!targetId || targetId === sess.userId || !(await findById(targetId))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  await blockUser(sess.userId, targetId);
  sendJson(reply, 200, { blocked: true });
}

async function handleUnblock(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  if (!targetId) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  await unblockUser(sess.userId, targetId);
  sendJson(reply, 200, { blocked: false });
}

export function registerBlockRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/blocks/:userId', handleBlock);
  fastify.delete('/api/blocks/:userId', handleUnblock);
}
