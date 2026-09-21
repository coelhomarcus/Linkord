import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';
import { findById } from '../users/users.js';
import { participants, send, setCallConversationId } from '../presence/participants.js';
import * as livekit from '../../integrations/livekit/livekit.js';
import { canManageGroup, getMemberRole } from '../conversations/conversationsRepository.js';
import { isActiveAdmin } from '../admin/adminAuth.js';
import { deleteUserAccount } from '../admin/adminUsers.js';
import { recordAudit } from '../admin/auditLog.js';
import { ERROR_CODES } from '../../http/errors.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// Admin-only moderation actions — account deletion (Settings "Moderation"
// tab) and kicking someone from a group call. Deleted users' messages don't disappear (authorId becomes NULL, so
// their profile resolves to the neutral deleted-user fallback). Deleting an
// account means "this person can't log in anymore," not "rewrite chat
// history". Sessions vanish via CASCADE.

/** Kick-from-call authority (docs/plano-rede-social.md §4.1): the OWNER of the
 * group the call belongs to, for someone who is a member of it. Instance
 * admins keep their existing power until the audited moderation flow (etapa
 * 11) replaces it — global role still doesn't make anyone an owner. */
export function canKickFromCall(input: { actorIsAdmin: boolean; actorOwnsGroup: boolean; targetIsMember: boolean }): boolean {
  return input.actorIsAdmin || (input.actorOwnsGroup && input.targetIsMember);
}

/** Legacy socket entry point of the Settings "Moderação" tab, kept only until
 * the /admin area replaces that tab (etapa 11, parte 3). It no longer owns any
 * logic: the deletion, its protections (self, last active admin), group
 * succession and the audit trail all live in admin/adminUsers.ts. */
async function handleUserDelete(socket: AppSocket, msg: { userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !(await isActiveAdmin(p.userId))) return;

  const targetId = String(msg.userId || '');
  if (!targetId) return;
  const target = await findById(targetId);
  if (!target) return; // already deleted (race with another admin, or invalid id)

  const result = await deleteUserAccount(
    { actor: { id: p.userId, username: p.name }, reason: 'Exclusão pela aba Moderação', requestId: '' },
    targetId, target.username,
  );
  if (result.code === 'self') send(socket, { t: 'error', code: 'cannot-delete-self', message: 'Você não pode apagar a própria conta por aqui.' });
  else if (result.code === 'last_admin') send(socket, { t: 'error', code: 'last-admin', message: 'Essa conta é o último administrador ativo.' });
}

/** Removes one CONNECTION (not account) from its current GROUP call —
 * `participantId` here already identifies exactly which tab to kick if the
 * same account has more than one open. Not a ban: they can rejoin the
 * call immediately. Deliberately doesn't apply to 1:1 direct calls: a
 * global admin force-disconnecting one side of someone else's private
 * call isn't a moderation power this app grants — "leave call" already
 * covers the natural 1:1 case. */
async function handleCallKick(socket: AppSocket, msg: { participantId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;

  const targetId = String(msg.participantId || '');
  if (!targetId || targetId === p.id) return;

  const target = participants.get(targetId);
  if (!target || !target.callConversationId) return; // already left — race with another admin, or stale UI

  const [callConversation] = await db.select({ type: conversations.type }).from(conversations).where(eq(conversations.id, target.callConversationId)).limit(1);
  if (callConversation?.type !== 'group') return;

  const callGroupId = target.callConversationId;
  const actorIsAdmin = await isActiveAdmin(p.userId);
  const actorOwnsGroup = await canManageGroup(callGroupId, p.userId);
  const allowed = canKickFromCall({
    actorIsAdmin,
    actorOwnsGroup,
    targetIsMember: (await getMemberRole(callGroupId, target.userId)) !== null,
  });
  if (!allowed) {
    send(socket, { t: 'error', code: ERROR_CODES.forbidden, message: 'Você não tem permissão para remover essa pessoa da chamada.' });
    return;
  }

  const roomName = `${config.LIVEKIT_ROOM_NAME}-${target.callConversationId}`;
  try {
    await livekit.kickParticipant(roomName, target.id);
  } catch (err) {
    console.warn(`[moderation] failed to kick ${target.id} from the call: ${err instanceof Error ? err.message : err}`);
    send(socket, { t: 'error', code: 'livekit-unavailable', message: 'Não foi possível remover da chamada agora.' });
    return;
  }
  // resets callConversationId + all self-reported media flags and broadcasts
  // participant-updated, so every OTHER connected client's UI (tiles) updates for free.
  setCallConversationId(target, null);

  // acting as an instance admin (not as the group's owner) is an audited moderation action
  if (actorIsAdmin && !actorOwnsGroup) {
    await recordAudit({
      actor: { id: p.userId, username: p.name }, action: 'call.kick', targetType: 'user', targetId: target.userId, targetLabel: target.name,
      detail: { conversationId: callGroupId },
    }).catch((err) => console.error('[audit] call.kick:', err instanceof Error ? err.message : err));
  }
}

export const handlers: HandlerTable = {
  'user-delete': handleUserDelete,
  'call-kick': handleCallKick,
};
