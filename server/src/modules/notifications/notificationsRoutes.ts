import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { countUnread, listNotifications, markRead } from './notificationsRepository.js';

async function session(request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  return sess;
}

export function registerNotificationRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/notifications', async (request: FastifyRequest<{ Querystring: { cursor?: string } }>, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const page = await listNotifications(sess.userId, request.query.cursor);
    if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
    sendJson(reply, 200, page);
  });

  fastify.get('/api/notifications/summary', async (request, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, { unread: await countUnread(sess.userId) });
  });

  fastify.post('/api/notifications/read', async (request, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const body = jsonBody(request.body);
    const ids = body.all === true ? 'all' as const : Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 100) : null;
    if (ids === null) return sendError(reply, 400, 'invalid_request', 'Informe ids ou all.');
    sendJson(reply, 200, { marked: await markRead(sess.userId, ids) });
  });
}
