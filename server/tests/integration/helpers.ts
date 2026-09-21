import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../../src/db/client.js';
import { conversationMembers, friendships, users } from '../../src/db/schema.js';

// Shared setup for the real-Postgres suite. Every test makes its own users and
// groups (unique names), so files never depend on each other or on order.

export { db, pool };

export async function makeUser(prefix: string, role: 'user' | 'admin' = 'user'): Promise<{ id: string; username: string }> {
  const id = crypto.randomUUID();
  const username = `${prefix}_${id.slice(0, 8)}`;
  await db.insert(users).values({ id, username, passwordHash: 'x', role });
  return { id, username };
}

export async function befriend(a: string, b: string): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await db.insert(friendships).values({ id: crypto.randomUUID(), userLowId: low, userHighId: high, requestedBy: a, status: 'accepted', acceptedAt: new Date() });
}

/** A group owned by `ownerId` with `memberIds` added straight into the table
 * (oldest first), the way it would look after invitations were accepted. */
export async function makeGroupWithMembers(ownerId: string, memberIds: string[], title = 'itest'): Promise<string> {
  const { createGroup } = await import('../../src/modules/conversations/conversationsRepository.js');
  const group = await createGroup(ownerId, title);
  for (let i = 0; i < memberIds.length; i++) {
    await db.insert(conversationMembers).values({ conversationId: group.id, userId: memberIds[i]!, role: 'member', joinedAt: new Date(Date.now() + i * 1000) });
  }
  return group.id;
}

export async function ownersOf(conversationId: string): Promise<string[]> {
  return (await db.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.role, 'owner')))).map((r) => r.userId);
}

export async function memberCount(conversationId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  return row?.n ?? 0;
}
