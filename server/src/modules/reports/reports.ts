import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import * as floodControl from '../../realtime/floodControl.js';
import { createReport } from './reportsRepository.js';
import { parseReportInput } from './reportsPolicy.js';

async function handleCreateReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  if (!floodControl.allow(`report:${sess.userId}`, { windowMs: 10 * 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Você enviou muitas denúncias. Espere um pouco.');
  }
  const input = parseReportInput(jsonBody(request.body));
  if (!input) return sendError(reply, 400, 'invalid_report', 'Denúncia inválida.');

  const result = await createReport(sess.userId, input);
  if (result.code === 'not_found') return sendError(reply, 404, 'not_found', 'Não encontrado.');
  if (result.code === 'invalid_target') return sendError(reply, 400, 'invalid_report', 'Não é possível denunciar isso.');
  // deliberately says nothing about the case's state or who it concerns
  sendJson(reply, 201, { ok: true });
}

export function registerReportRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/reports', handleCreateReport);
}
