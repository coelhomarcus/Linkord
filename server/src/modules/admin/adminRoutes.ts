import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { requireAdmin } from './adminAuth.js';
import { normalizeReason } from './adminPolicy.js';
import { listAudit } from './auditLog.js';
import {
  deleteUserAccount, getAdminUser, listAdminUsers, reactivateUser, revokeUserSessions, setAdminRole, suspendUser,
  type AdminRoleResult, type UserActionResult,
} from './adminUsers.js';
import {
  assignGroupOwner, deleteGroupAsAdmin, getAdminGroup, listAdminGroups, reactivateGroup, suspendGroup,
  type GroupActionResult,
} from './adminGroups.js';
import { claimReport, getAdminReport, listAdminReports, resolveReport, type ReportActionResult } from './adminReports.js';
import type { AuditActor } from './auditLog.js';
import { getSystemInfo } from './adminSystem.js';
import { sweepOrphans } from '../attachments/orphanSweeper.js';
import type { ReportAction } from '../reports/reportsPolicy.js';

type Query = Record<string, string | undefined>;
type IdParams = { id: string };

const ERRORS: Record<string, [number, string, string]> = {
  not_found: [404, 'not_found', 'Não encontrado.'],
  forbidden: [403, 'forbidden', 'Você não tem mais permissão de administrador.'],
  self: [409, 'self_action', 'Você não pode fazer isso na própria conta.'],
  last_admin: [409, 'last_admin', 'Essa conta é o último administrador ativo.'],
  already_suspended: [409, 'already_suspended', 'Já está suspenso.'],
  not_suspended: [409, 'not_suspended', 'Não está suspenso.'],
  not_member: [409, 'not_member', 'Essa conta não é membro do grupo.'],
  confirmation_mismatch: [400, 'confirmation_mismatch', 'A confirmação não confere.'],
  already_admin: [409, 'already_admin', 'Essa conta já é administradora.'],
  not_admin: [409, 'not_admin', 'Essa conta não é administradora.'],
  target_inactive: [409, 'target_inactive', 'Só uma conta ativa pode virar administradora.'],
  already_closed: [409, 'already_closed', 'Essa denúncia já foi encerrada.'],
  not_open: [409, 'not_open', 'Essa denúncia já está em análise.'],
  invalid_action: [400, 'invalid_action', 'Essa ação não se aplica a esse tipo de denúncia.'],
  action_failed: [409, 'action_failed', 'Não foi possível aplicar a ação; a denúncia continua aberta.'],
};

function respond(reply: FastifyReply, result: UserActionResult | GroupActionResult | ReportActionResult | AdminRoleResult): void {
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
  fastify.post('/api/admin/users/:id/grant-admin', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await setAdminRole({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, 'grant'));
  });
  fastify.post('/api/admin/users/:id/revoke-admin', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await setAdminRole({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, 'revoke'));
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

  fastify.get('/api/admin/reports', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { status, targetType, cursor } = request.query;
    return listAdminReports({ status, targetType }, cursor);
  }));
  fastify.get('/api/admin/reports/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const actor = await requireAdmin(request, reply);
    if (!actor) return;
    const detail = await getAdminReport({ actor, requestId: request.id }, request.params.id);
    if (!detail) return sendError(reply, 404, 'not_found', 'Não encontrado.');
    sendJson(reply, 200, detail);
  });
  fastify.post('/api/admin/reports/:id/claim', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await claimReport({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/reports/:id/resolve', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (!m) return;
    const action = m.body.action == null || m.body.action === '' ? null : String(m.body.action) as ReportAction;
    if (action !== null && !['suspend_user', 'suspend_group', 'delete_message'].includes(action)) {
      return sendError(reply, 400, 'invalid_action', 'Ação inválida.');
    }
    respond(reply, await resolveReport({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, { dismiss: m.body.dismiss === true, action }));
  });

  fastify.get('/api/admin/system', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    sendJson(reply, 200, await getSystemInfo());
  });
  // A dry run only reports and needs no justification; deleting files does.
  fastify.post('/api/admin/system/sweep-orphans', async (request, reply) => {
    const body = request.body == null ? {} : jsonBody(request.body);
    if (body.dryRun !== false) {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      return sendJson(reply, 200, { result: await sweepOrphans({ dryRun: true, actor, requestId: request.id }) });
    }
    const m = await mutating(request, reply);
    if (!m) return;
    sendJson(reply, 200, { result: await sweepOrphans({ dryRun: false, actor: m.actor, requestId: request.id, reason: m.reason }) });
  });

  fastify.get('/api/admin/audit', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { actor, targetType, targetId, action, from, to, cursor } = request.query;
    return listAudit({ actor, targetType, targetId, action, from, to }, cursor);
  }));
}
