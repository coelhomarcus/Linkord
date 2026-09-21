import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations } from '../../db/schema.js';
import { revokePendingForGroup } from './invitationRevocation.js';

type Role = 'owner' | 'member' | null;

export type RemovalDecision = 'allow' | 'forbidden' | 'owner_must_transfer' | 'not_member';

/** Who may take `targetRole` out of a group (docs/plano-rede-social.md §4.1):
 * the owner removes anyone else, a member can only leave, and the owner can
 * only leave once alone — otherwise the group would be left without one. */
export function decideRemoval(input: { actorRole: Role; targetRole: Role; isSelf: boolean; memberCount: number }): RemovalDecision {
  const { actorRole, targetRole, isSelf, memberCount } = input;
  if (!targetRole) return 'not_member';
  if (!actorRole) return 'forbidden';
  if (isSelf) return actorRole === 'owner' && memberCount > 1 ? 'owner_must_transfer' : 'allow';
  return actorRole === 'owner' ? 'allow' : 'forbidden';
}

export type RemoveMemberResult =
  | { code: 'ok'; remainingIds: string[] }
  | { code: 'not_found' | 'not_member' | 'forbidden' | 'owner_must_transfer' };

/** Removes a member under the group row lock, so a concurrent transfer,
 * leave or removal sees either the state before or after — never a group
 * whose owner was removed halfway through someone else's transfer. Lock
 * order matches the rest of the group operations (group row first). */
export async function removeMember(conversationId: string, actorId: string, targetId: string): Promise<RemoveMemberResult> {
  return db.transaction(async (tx): Promise<RemoveMemberResult> => {
    const locked = await tx.execute(sql`select id from conversations where id = ${conversationId} and type = 'group' for update`);
    if (locked.rows.length === 0) return { code: 'not_found' };

    const members = await tx.select({ userId: conversationMembers.userId, role: conversationMembers.role })
      .from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    const roleOf = (userId: string): Role => (members.find((m) => m.userId === userId)?.role as Role | undefined) ?? null;

    const decision = decideRemoval({ actorRole: roleOf(actorId), targetRole: roleOf(targetId), isSelf: actorId === targetId, memberCount: members.length });
    if (decision !== 'allow') return { code: decision };

    await tx.delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, targetId)));
    return { code: 'ok', remainingIds: members.filter((m) => m.userId !== targetId).map((m) => m.userId) };
  });
}

export async function isGroup(conversationId: string): Promise<boolean> {
  const [row] = await db.select({ type: conversations.type }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  return row?.type === 'group';
}

export type TransferDecision = 'allow' | 'forbidden' | 'not_member';

/** Ownership only moves from the current owner to an existing plain member. */
export function decideTransfer(input: { actorRole: Role; targetRole: Role; isSelf: boolean }): TransferDecision {
  if (input.actorRole !== 'owner' || input.isSelf) return 'forbidden';
  return input.targetRole === 'member' ? 'allow' : 'not_member';
}

export type TransferResult =
  | { code: 'ok'; revokedInvitationIds: string[] }
  | { code: 'not_found' | 'forbidden' | 'not_member' };

/** Validates AND swaps under the group row lock. Checking the roles before
 * taking the lock (as the handler used to) let a concurrent removal of the
 * new owner slip in between, and the swap then promoted nobody — a group
 * with no owner (§4.2.1). */
export async function transferOwnership(conversationId: string, actorId: string, newOwnerId: string): Promise<TransferResult> {
  return db.transaction(async (tx): Promise<TransferResult> => {
    const locked = await tx.execute(sql`select id from conversations where id = ${conversationId} and type = 'group' for update`);
    if (locked.rows.length === 0) return { code: 'not_found' };

    const members = await tx.select({ userId: conversationMembers.userId, role: conversationMembers.role })
      .from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    const roleOf = (userId: string): Role => (members.find((m) => m.userId === userId)?.role as Role | undefined) ?? null;
    const decision = decideTransfer({ actorRole: roleOf(actorId), targetRole: roleOf(newOwnerId), isSelf: actorId === newOwnerId });
    if (decision !== 'allow') return { code: decision };

    await tx.update(conversationMembers).set({ role: 'member' })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actorId)));
    await tx.update(conversationMembers).set({ role: 'owner' })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, newOwnerId)));
    // whatever the previous owner still had pending dies with their ownership
    return { code: 'ok', revokedInvitationIds: await revokePendingForGroup(tx, conversationId) };
  });
}
