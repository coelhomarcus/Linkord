import { and, eq, or, sql } from 'drizzle-orm';
import { groupInvitations } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';

// Leaf module (db/schema only) on purpose: blocks/ and friendships/ must
// invalidate pending invitations INSIDE their own transaction, while
// invitationsRepository.ts imports both of them — a helper living there would
// make a cycle. Every function returns the revoked ids so the caller can push
// `invitation-updated` AFTER the commit.

/** Losing the friendship or blocking invalidates a pending invitation between
 * the two, in either direction (docs/plano-rede-social.md §7.2.5, §7.3). */
export async function revokePendingBetween(tx: Tx, a: string, b: string): Promise<string[]> {
  const rows = await tx.update(groupInvitations)
    .set({ status: 'revoked', respondedAt: new Date(), version: sql`${groupInvitations.version} + 1` })
    .where(and(
      eq(groupInvitations.status, 'pending'),
      or(
        and(eq(groupInvitations.inviterId, a), eq(groupInvitations.inviteeId, b)),
        and(eq(groupInvitations.inviterId, b), eq(groupInvitations.inviteeId, a)),
      ),
    ))
    .returning({ id: groupInvitations.id });
  return rows.map((r) => r.id);
}

/** A change of owner revokes what the previous owner had pending (§7.2.5) —
 * the new owner decides for themselves whom to invite. */
export async function revokePendingForGroup(tx: Tx, conversationId: string): Promise<string[]> {
  const rows = await tx.update(groupInvitations)
    .set({ status: 'revoked', respondedAt: new Date(), version: sql`${groupInvitations.version} + 1` })
    .where(and(eq(groupInvitations.conversationId, conversationId), eq(groupInvitations.status, 'pending')))
    .returning({ id: groupInvitations.id });
  return rows.map((r) => r.id);
}
