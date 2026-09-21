import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations } from '../../db/schema.js';
import { sendToUser } from '../presence/participants.js';
import { refreshKnownPeers } from '../presence/knownPeers.js';
import { deleteForConversation } from '../attachments/attachmentCleanup.js';
import { revokeCallAccess } from '../calls/callAccess.js';

/** Deletes a group for good — files first (the rows that name them go with the
 * group), then the group, then tells every member and cuts their calls.
 * Shared by the owner's own "delete group" and the administrative one; the
 * caller has already authorized it. Returns null when there is no such group. */
export async function deleteGroupCompletely(conversationId: string): Promise<{ memberIds: string[]; title: string } | null> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return null;
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  await deleteForConversation(conversationId);
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  for (const member of memberRows) {
    sendToUser(member.userId, { t: 'conversation-deleted', conversationId, reason: 'deleted' });
    void revokeCallAccess(member.userId, conversationId);
  }
  const memberIds = memberRows.map((row) => row.userId);
  await refreshKnownPeers(memberIds);
  return { memberIds, title: conversation.title };
}
