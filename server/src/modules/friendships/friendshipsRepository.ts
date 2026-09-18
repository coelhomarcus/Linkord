import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { friendships, notifications, outboxEvents, type Friendship } from '../../db/schema.js';
import { findByUsernameLower } from '../users/users.js';
import { canonicalUserPair, withUserPairLock, type Tx } from '../users/userPairLock.js';
import { isBlockedEitherWay } from '../blocks/blocksRepository.js';

export type FriendshipResult =
  | { code: 'created'; friendship: Friendship }
  | { code: 'already_friends'; friendship: Friendship }
  | { code: 'already_pending'; friendship: Friendship; direction: 'outgoing' }
  | { code: 'pending_received'; friendship: Friendship; direction: 'incoming' }
  | { code: 'cooldown'; retryAfter: Date }
  | { code: 'user_unavailable' }
  | { code: 'accepted'; friendship: Friendship }
  | { code: 'declined'; friendship: Friendship }
  | { code: 'cancelled'; friendship: Friendship }
  | { code: 'removed'; friendship: Friendship }
  | { code: 'not_found' }
  | { code: 'forbidden' }
  | { code: 'invalid_state' };

export async function getFriendship(a: string, b: string, executor: Tx | typeof db = db): Promise<Friendship | null> {
  const [low, high] = canonicalUserPair(a, b);
  const [row] = await executor.select().from(friendships)
    .where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high))).limit(1);
  return row ?? null;
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await getFriendship(a, b);
  return row?.status === 'accepted';
}

/** The one policy op messages.ts/socket.ts/attachmentUploads.ts actually
 * call — the write-path gate for a direct conversation
 * (docs/plano-rede-social.md §4.3). Block wins over friendship: even a
 * lingering 'accepted' row (there shouldn't be one — blockUser ends it in
 * the same transaction — but this stays defense-in-depth, per §6.1 "bloqueio
 * não é um status da amizade") never allows contact. */
export async function canSendDirectMessage(a: string, b: string): Promise<boolean> {
  if (await isBlockedEitherWay(a, b)) return false;
  return areFriends(a, b);
}

export function isWithinCooldown(retryAfter: Date | null, now = new Date()): boolean {
  return !!retryAfter && now < retryAfter;
}

/** Writes the notification + outbox row for a friendship event in the SAME
 * transaction as the state change that caused it (§7.1 step 4). Nothing
 * consumes either table yet (no worker, no notification center — that's
 * Etapa 7+); this is the write side of a pattern etapa 5 already scoped for.
 * `dedupeKey` is deterministic per (friendship, version) so a retried write
 * can't double up. Only 'created' and 'accepted' get one — decline/cancel/
 * remove have no matching `kind` in the notifications table's CHECK
 * constraint (schema.ts), and a rejection isn't meant to be presented as a
 * hostile notification to the sender (§5.3). */
async function recordFriendshipEvent(tx: Tx, recipientId: string, kind: 'friend_request' | 'friend_accepted', friendship: Friendship, eventType: string): Promise<void> {
  const dedupeKey = `${kind}:${friendship.id}:${friendship.version}`;
  await tx.insert(notifications).values({
    id: crypto.randomUUID(), recipientId, kind, friendshipId: friendship.id, dedupeKey,
  }).onConflictDoNothing();
  await tx.insert(outboxEvents).values({
    id: crypto.randomUUID(), type: eventType, audienceUserId: recipientId,
    payload: { friendshipId: friendship.id },
  });
}

/** §7.1. Resolves the target by exact username (case-insensitive, same
 * lookup every other username-facing flow uses), then serializes everything
 * else through the pair lock so two concurrent requests for the same pair
 * (two tabs, or a request racing an accept/block) can't produce two rows or
 * a stale transition. */
export async function requestFriendship(fromUserId: string, toUsername: string): Promise<FriendshipResult> {
  const target = await findByUsernameLower(toUsername);
  // "não revelar bloqueio reverso" (§5.3): a nonexistent account and a
  // block in EITHER direction produce the exact same response.
  if (!target || target.id === fromUserId || await isBlockedEitherWay(fromUserId, target.id)) {
    return { code: 'user_unavailable' };
  }
  const toUserId = target.id;
  return withUserPairLock(fromUserId, toUserId, async (tx) => {
    const existing = await getFriendship(fromUserId, toUserId, tx);
    if (!existing) {
      const [low, high] = canonicalUserPair(fromUserId, toUserId);
      const [row] = await tx.insert(friendships).values({
        id: crypto.randomUUID(), userLowId: low, userHighId: high, requestedBy: fromUserId,
      }).returning();
      await recordFriendshipEvent(tx, toUserId, 'friend_request', row!, 'friend_request_created');
      return { code: 'created', friendship: row! };
    }
    if (existing.status === 'accepted') return { code: 'already_friends', friendship: existing };
    if (existing.status === 'pending') {
      // §7.1 step 3: same direction is a no-op retry; the reverse direction
      // hands back the pending request the CALLER received, instead of
      // silently auto-accepting it — accepting is its own explicit action.
      return existing.requestedBy === fromUserId
        ? { code: 'already_pending', friendship: existing, direction: 'outgoing' as const }
        : { code: 'pending_received', friendship: existing, direction: 'incoming' as const };
    }
    // declined | cancelled | removed — eligible for a new cycle once past
    // cooldown. Deliberately symmetric (gates a request from EITHER side of
    // the pair, not just whoever was `requestedBy` before) — simpler than a
    // per-direction rule and the plan doesn't ask for one.
    if (isWithinCooldown(existing.retryAfter)) {
      return { code: 'cooldown', retryAfter: existing.retryAfter! };
    }
    const [row] = await tx.update(friendships).set({
      status: 'pending', requestedBy: fromUserId, version: sql`${friendships.version} + 1`,
      updatedAt: new Date(), acceptedAt: null, respondedAt: null, retryAfter: null,
    }).where(eq(friendships.id, existing.id)).returning();
    await recordFriendshipEvent(tx, toUserId, 'friend_request', row!, 'friend_request_created');
    return { code: 'created', friendship: row! };
  });
}

/** Only the recipient of a pending request (`requestedBy !== userId`) can
 * accept it — the requester "accepting" their own outgoing request isn't a
 * real action. */
export async function acceptFriendRequest(userId: string, otherUserId: string): Promise<FriendshipResult> {
  return withUserPairLock(userId, otherUserId, async (tx) => {
    const existing = await getFriendship(userId, otherUserId, tx);
    if (!existing) return { code: 'not_found' };
    if (existing.status === 'accepted') return { code: 'already_friends', friendship: existing };
    if (existing.status !== 'pending') return { code: 'invalid_state' };
    if (existing.requestedBy !== otherUserId) return { code: 'forbidden' };
    const [row] = await tx.update(friendships).set({
      status: 'accepted', acceptedAt: new Date(), respondedAt: new Date(),
      version: sql`${friendships.version} + 1`, updatedAt: new Date(),
    }).where(eq(friendships.id, existing.id)).returning();
    await recordFriendshipEvent(tx, otherUserId, 'friend_accepted', row!, 'friend_request_accepted');
    return { code: 'accepted', friendship: row! };
  });
}

/** Only the recipient declines. Idempotent: declining an already-declined
 * request just returns its current state instead of erroring. */
export async function declineFriendRequest(userId: string, otherUserId: string): Promise<FriendshipResult> {
  return withUserPairLock(userId, otherUserId, async (tx) => {
    const existing = await getFriendship(userId, otherUserId, tx);
    if (!existing) return { code: 'not_found' };
    if (existing.status === 'declined') return { code: 'declined', friendship: existing };
    if (existing.status !== 'pending') return { code: 'invalid_state' };
    if (existing.requestedBy !== otherUserId) return { code: 'forbidden' };
    const [row] = await tx.update(friendships).set({
      status: 'declined', respondedAt: new Date(), retryAfter: new Date(Date.now() + config.FRIEND_REQUEST_COOLDOWN_MS),
      version: sql`${friendships.version} + 1`, updatedAt: new Date(),
    }).where(eq(friendships.id, existing.id)).returning();
    return { code: 'declined', friendship: row! };
  });
}

/** Only the requester cancels their own outgoing request. Idempotent. */
export async function cancelFriendRequest(userId: string, otherUserId: string): Promise<FriendshipResult> {
  return withUserPairLock(userId, otherUserId, async (tx) => {
    const existing = await getFriendship(userId, otherUserId, tx);
    if (!existing) return { code: 'not_found' };
    if (existing.status === 'cancelled') return { code: 'cancelled', friendship: existing };
    if (existing.status !== 'pending') return { code: 'invalid_state' };
    if (existing.requestedBy !== userId) return { code: 'forbidden' };
    const [row] = await tx.update(friendships).set({
      status: 'cancelled', respondedAt: new Date(), retryAfter: new Date(Date.now() + config.FRIEND_REQUEST_COOLDOWN_MS),
      version: sql`${friendships.version} + 1`, updatedAt: new Date(),
    }).where(eq(friendships.id, existing.id)).returning();
    return { code: 'cancelled', friendship: row! };
  });
}

/** Unfriending — either side of an accepted friendship, idempotent. */
export async function removeFriendship(userId: string, otherUserId: string): Promise<FriendshipResult> {
  return withUserPairLock(userId, otherUserId, async (tx) => {
    const existing = await getFriendship(userId, otherUserId, tx);
    if (!existing) return { code: 'not_found' };
    if (existing.status === 'removed') return { code: 'removed', friendship: existing };
    if (existing.status !== 'accepted') return { code: 'invalid_state' };
    const [row] = await tx.update(friendships).set({
      status: 'removed', respondedAt: new Date(), retryAfter: new Date(Date.now() + config.FRIEND_REQUEST_COOLDOWN_MS),
      version: sql`${friendships.version} + 1`, updatedAt: new Date(),
    }).where(eq(friendships.id, existing.id)).returning();
    return { code: 'removed', friendship: row! };
  });
}
