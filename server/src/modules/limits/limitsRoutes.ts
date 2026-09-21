import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { getUserLimits } from './limits.js';

async function handleMyLimits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  sendJson(reply, 200, { limits: await getUserLimits(sess.userId) });
}

export function registerLimitsRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/me/limits', handleMyLimits);
}
