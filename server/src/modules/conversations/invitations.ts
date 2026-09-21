import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import * as floodControl from '../../realtime/floodControl.js';
import { sendToUser } from '../presence/participants.js';
import { groupCreationBlockedBy } from '../limits/limits.js';
import { createGroup, rowToSummary, sanitizeConversationTitle } from './conversationsRepository.js';
import {
  acceptInvitation, createInvitations, declineInvitation, listGroupInvitations, listReceivedInvitations,
  normalizeInviteeIds, revokeInvitation, type InvitationAction, type InviteResult,
} from './invitationsRepository.js';

// HTTP surface of group invitations (docs/plano-rede-social.md §8.2): commands
// answer with an explicit, per-recipient result, lists are cursor-paginated
// with a server-fixed page size. Same session/cookie pattern as friendships.ts.

type IdParams = { id: string };
type GroupParams = { conversationId: string };

async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) {
    sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    return null;
  }
  return sess;
}

function respondAction(reply: FastifyReply, result: InvitationAction): void {
  switch (result.code) {
    case 'ok': return sendJson(reply, 200, { invitation: result.card });
    case 'not_found': return sendError(reply, 404, 'not_found', 'Convite não encontrado.');
    case 'forbidden': return sendError(reply, 403, 'forbidden', 'Você não pode fazer isso.');
    case 'invalid_state': return sendError(reply, 409, 'conflict', 'Esse convite não está mais nesse estado.');
    case 'expired': return sendError(reply, 409, 'invitation_expired', 'Esse convite expirou.');
    case 'group_full': return sendError(reply, 409, 'group_full', 'O grupo já está cheio.');
    case 'quota_exceeded': return sendError(reply, 409, 'quota_exceeded', 'Você já participa do máximo de grupos permitido.');
  }
}

function respondInviteError(reply: FastifyReply, error: 'not_found' | 'forbidden' | 'too_many'): void {
  if (error === 'not_found') return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
  if (error === 'forbidden') return sendError(reply, 403, 'forbidden', 'Você não tem permissão para gerenciar esse grupo.');
  return sendError(reply, 400, 'too_many_invitees', `Convide até ${config.MAX_INVITEES_PER_REQUEST} pessoas por vez.`);
}

/** Creates the group (creator is its only member) and invites the chosen
 * friends. Answered only AFTER the group exists, with each invitation's own
 * result — a failed invite never undoes the group, and the client can say
 * exactly which ones need another try (§5.5). */
async function handleCreateGroup(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`group-create:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está criando grupos rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const title = sanitizeConversationTitle(body.title);
  if (!title) return sendError(reply, 400, 'invalid_title', 'Dê um nome ao grupo.');
  const { ids, tooMany } = normalizeInviteeIds(body.inviteeIds, sess.userId);
  if (tooMany) return respondInviteError(reply, 'too_many');

  if (await groupCreationBlockedBy(sess.userId)) {
    return sendError(reply, 409, 'quota_exceeded', 'Você atingiu o limite de grupos. Saia ou apague algum antes de criar outro.');
  }
  const conversation = await createGroup(sess.userId, title);
  sendToUser(sess.userId, { t: 'conversation-opened', conversationId: conversation.id, conversation: rowToSummary(conversation, [sess.userId], null, 'owner', sess.userId) });
  let results: InviteResult[] = [];
  if (ids.length) {
    const invited = await createInvitations(sess.userId, conversation.id, ids);
    if ('results' in invited) results = invited.results;
  }
  sendJson(reply, 201, { conversationId: conversation.id, results });
}

async function handleInvite(request: FastifyRequest<{ Params: GroupParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`group-invite:${sess.userId}`, { windowMs: 60_000, max: 20 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está enviando convites rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const result = await createInvitations(sess.userId, String(request.params.conversationId || ''), body.userIds);
  if ('error' in result) return respondInviteError(reply, result.error);
  sendJson(reply, 200, { results: result.results });
}

async function handleListSent(request: FastifyRequest<{ Params: GroupParams; Querystring: { cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const page = await listGroupInvitations(sess.userId, String(request.params.conversationId || ''), request.query.cursor);
  if (page === 'forbidden') return sendError(reply, 403, 'forbidden', 'Você não tem permissão para gerenciar esse grupo.');
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleListReceived(request: FastifyRequest<{ Querystring: { cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const page = await listReceivedInvitations(sess.userId, request.query.cursor);
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleAccept(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondAction(reply, await acceptInvitation(sess.userId, String(request.params.id || '')));
}

async function handleDecline(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondAction(reply, await declineInvitation(sess.userId, String(request.params.id || '')));
}

async function handleRevoke(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondAction(reply, await revokeInvitation(sess.userId, String(request.params.id || '')));
}

export function registerInvitationRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/groups', handleCreateGroup);
  fastify.post('/api/groups/:conversationId/invitations', handleInvite);
  fastify.get('/api/groups/:conversationId/invitations', handleListSent);
  fastify.get('/api/group-invitations', handleListReceived);
  fastify.post('/api/group-invitations/:id/accept', handleAccept);
  fastify.post('/api/group-invitations/:id/decline', handleDecline);
  fastify.delete('/api/group-invitations/:id', handleRevoke);
}
