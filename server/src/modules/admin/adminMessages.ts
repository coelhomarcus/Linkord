import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { deleteForMessage } from '../attachments/attachmentCleanup.js';
import { broadcastToConversationMembers, recordConversationActivity } from '../conversations/conversationsRepository.js';
import { recordAudit, type AuditActor } from './auditLog.js';

/** Removes one message on an administrator's authority (a report's outcome).
 * Same effect as the author deleting it; the trail carries ids only, never the
 * body. The admin does not need to be — and is not made — a member. */
export async function deleteMessageAsAdmin(ctx: { actor: AuditActor; reason: string; requestId: string }, msgId: number): Promise<{ code: 'ok' | 'not_found' }> {
  const [existing] = await db.select({ conversationId: messages.conversationId, authorId: messages.authorId }).from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing) return { code: 'not_found' };
  await recordAudit({
    actor: ctx.actor, action: 'message.delete', targetType: 'message', targetId: String(msgId), reason: ctx.reason,
    detail: { conversationId: existing.conversationId, authorId: existing.authorId, via: 'report' }, requestId: ctx.requestId,
  });
  await deleteForMessage(msgId);
  await db.delete(messages).where(eq(messages.id, msgId));
  await recordConversationActivity(existing.conversationId);
  await broadcastToConversationMembers(existing.conversationId, { t: 'chat-deleted', conversationId: existing.conversationId, msgId });
  return { code: 'ok' };
}
