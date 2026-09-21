import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';
import { participants, setCallConversationId } from '../presence/participants.js';
import { dmKeyFor } from '../conversations/conversationsRepository.js';
import { evictFromCall } from '../../integrations/livekit/livekit.js';

/** Cuts an account's live call access for one conversation after the
 * database already revoked it (removal, group deletion, block, unfriend,
 * account deletion): resets the socket-side call state of every connection
 * the account has in that call, then removes them from the SFU — the socket
 * state alone leaves the media connection open. Callers run it AFTER the
 * commit and don't wait on it; it never throws. */
export async function revokeCallAccess(userId: string, conversationId: string): Promise<void> {
  const identities: string[] = [];
  for (const p of participants.values()) {
    if (p.userId !== userId || p.callConversationId !== conversationId) continue;
    identities.push(p.id);
    setCallConversationId(p, null);
  }
  try {
    await evictFromCall(userId, conversationId, identities);
  } catch (err) {
    console.error(`[calls] failed to revoke call access of ${userId} in ${conversationId}:`, err instanceof Error ? err.stack : err);
  }
}

/** A block or an unfriend ends the private call between the two accounts. */
export async function revokeDirectCallAccess(a: string, b: string): Promise<void> {
  try {
    const [dm] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.dmKey, dmKeyFor(a, b))).limit(1);
    if (!dm) return;
    await Promise.all([revokeCallAccess(a, dm.id), revokeCallAccess(b, dm.id)]);
  } catch (err) {
    console.error('[calls] failed to revoke direct call access:', err instanceof Error ? err.stack : err);
  }
}
