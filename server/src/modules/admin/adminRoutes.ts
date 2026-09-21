import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { requireAdmin } from './adminAuth.js';
import { normalizeReason } from './adminPolicy.js';
import { listAudit } from './auditLog.js';
import {
  deleteUserAccount, getAdminUser, listAdminUsers, reactivateUser, revokeUserSessions, suspendUser,
  type UserActionResult,
} from './adminUsers.js';
import {
  assignGroupOwner, deleteGroupAsAdmin, getAdminGroup, listAdminGroups, reactivateGroup, suspendGroup,
  type GroupActionResult,
} from './adminGroups.js';
import type { AuditActor } from './auditLog.js';

type Query = Record<string, string | undefined>;
type IdParams = { id: string };

const ERRORS: Record<string, [number, string, string]> = {
  not_found: [404, 'not_found', 'Não encontrado.'],
  self: [409, 'self_action', 'Você não pode fazer isso na própria conta.'],
  last_admin: [409, 'last_admin', 'Essa conta é o último administrador ativo.'],
  already_suspended: [409, 'already_suspended', 'Já está suspenso.'],
  not_suspended: [409, 'not_suspended', 'Não está suspenso.'],
  not_member: [409, 'not_member', 'Essa conta não é membro do grupo.'],
  confirmation_mismatch: [400, 'confirmation_mismatch', 'A confirmação não confere.'],
};

function respond(reply: FastifyReply, result: UserActionResult | GroupActionResult): void {
  if (result.code === 'ok') return sendJson(reply, 200, { ok: true });
  const [status, code, message] = ERRORS[result.code] ?? [500, 'internal_error', 'Erro interno.'];
  sendError(reply, status, code, message);
}

/** Auth + the shared preamble of every mutating action: an active admin RIGHT
 * NOW, inside the destructive-action rate limit, with a written reason. */
async function mutating(request: FastifyRequest, reply: FastifyReply): Promise<{ actor: AuditActor; reason: string; body: Record<string, unknown> } | null> {
  const actor = await requireAdmin(request, reply);
  if (!actor) return null;
  if (!floodControl.allow(`admin-action:${actor.id}`, { windowMs: 60_000, max: 30 })) {
    sendError(reply, 429, 'rate_limited', 'Muitas ações seguidas. Espere um pouco.');
    return null;
  }
  const body = request.body == null ? {} : jsonBody(request.body);
  const reason = normalizeReason(body.reason);
  if (!reason) {
    sendError(reply, 400, 'reason_required', 'Informe o motivo (3 a 500 caracteres).');
    return null;
  }
  return { actor, reason, body };
}

async function reading<T>(request: FastifyRequest, reply: FastifyReply, run: () => Promise<T | 'invalid_cursor' | null>): Promise<void> {
  if (!(await requireAdmin(request, reply))) return;
  const result = await run();
  if (result === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  if (result === null) return sendError(reply, 404, 'not_found', 'Não encontrado.');
  sendJson(reply, 200, result);
}

export function registerAdminRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/admin/users', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { q, status, role, from, to, cursor } = request.query;
    return listAdminUsers({ q, status, role, from, to }, cursor);
  }));
  fastify.get('/api/admin/users/:id', (request: FastifyRequest<{ Params: IdParams }>, reply) => reading(request, reply, () => getAdminUser(request.params.id)));

  fastify.post('/api/admin/users/:id/suspend', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await suspendUser({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/users/:id/reactivate', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await reactivateUser({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/users/:id/revoke-sessions', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await revokeUserSessions({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.delete('/api/admin/users/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await deleteUserAccount({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, String(m.body.confirm ?? '')));
  });

  fastify.get('/api/admin/groups', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { q, status, orphan, cursor } = request.query;
    return listAdminGroups({ q, status, orphan: orphan === '1' }, cursor);
  }));
  fastify.get('/api/admin/groups/:id', (request: FastifyRequest<{ Params: IdParams; Querystring: Query }>, reply) => reading(request, reply, () => getAdminGroup(request.params.id, request.query.cursor)));
  fastify.post('/api/admin/groups/:id/suspend', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await suspendGroup({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/groups/:id/reactivate', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await reactivateGroup({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/groups/:id/owner', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (!m) return;
    const userId = String(m.body.userId ?? '');
    if (!userId) return sendError(reply, 400, 'invalid_request', 'Informe o novo dono.');
    respond(reply, await assignGroupOwner({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, userId));
  });
  fastify.delete('/api/admin/groups/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await deleteGroupAsAdmin({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });

  fastify.get('/api/admin/audit', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { actor, targetType, targetId, action, from, to, cursor } = request.query;
    return listAudit({ actor, targetType, targetId, action, from, to }, cursor);
  }));
}
