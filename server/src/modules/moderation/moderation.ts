import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';
import { participants, send, setCallConversationId } from '../presence/participants.js';
import * as livekit from '../../integrations/livekit/livekit.js';
import { canManageGroup, getMemberRole } from '../conversations/conversationsRepository.js';
import { isActiveAdmin } from '../admin/adminAuth.js';
import { recordAudit } from '../admin/auditLog.js';
import { ERROR_CODES } from '../../http/errors.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// Kicking someone out of a group call (the owner of that group, or an instance
// admin). Account deletion, suspension and the rest of the administrative
// actions live in modules/admin/ (HTTP, audited).

/** Kick-from-call authority (docs/plano-rede-social.md §4.1): the OWNER of the
 * group the call belongs to, for someone who is a member of it. Instance
 * admins keep their existing power until the audited moderation flow (etapa
 * 11) replaces it — global role still doesn't make anyone an owner. */
export function canKickFromCall(input: { actorIsAdmin: boolean; actorOwnsGroup: boolean; targetIsMember: boolean }): boolean {
  return input.actorIsAdmin || (input.actorOwnsGroup && input.targetIsMember);
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
  'call-kick': handleCallKick,
};
