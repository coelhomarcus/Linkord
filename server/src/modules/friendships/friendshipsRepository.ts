import crypto from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { friendships, notifications, outboxEvents, users, type Friendship } from '../../db/schema.js';
import { findByUsernameLower, toSocialUser, type SocialUser } from '../users/users.js';
import { canonicalUserPair, withUserPairLock, type Tx } from '../users/userPairLock.js';
import { isBlocked, isBlockedEitherWay } from '../blocks/blocksRepository.js';
import { revokePendingBetween } from '../conversations/invitationRevocation.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, decodeUsernameCursor, encodeTimeCursor, escapeLike } from './cursor.js';

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
  // ids of pending group invitations the removal invalidated (§7.2.5) — the
  // HTTP layer announces them once the transaction has committed
  | { code: 'removed'; friendship: Friendship; revokedInvitationIds?: string[] }
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

/** Every accepted friend's id, either side of the pair — used to compute
 * the "known peers" presence-scoping set (realtime/socket.ts) and profile
 * visibility (usersRoutes.ts). */
export async function listFriendIds(userId: string): Promise<string[]> {
  const rows = await db.select({ userLowId: friendships.userLowId, userHighId: friendships.userHighId })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'accepted'),
      or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId)),
    ));
  return rows.map((r) => (r.userLowId === userId ? r.userHighId : r.userLowId));
}

export interface SocialEntry { user: SocialUser; at: string }
export interface SocialPage { items: SocialEntry[]; nextCursor: string | null }
export type Relation = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked';

// the "other side" of a friendship row, relative to `userId` — lets one
// join hydrate the counterpart without a second query per row
const otherSideOf = (userId: string) =>
  sql`case when ${friendships.userLowId} = ${userId} then ${friendships.userHighId} else ${friendships.userLowId} end`;

const microsecondIso = (col: typeof friendships.updatedAt) =>
  sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The caller's accepted friends, alphabetical by username (keyset
 * pagination — see cursor.ts). `q` narrows to username/displayName matches
 * within THIS user's friends only, never a global search. */
export async function listFriends(userId: string, opts: { cursor?: string; q?: string }): Promise<SocialPage | 'invalid_cursor'> {
  let after: string | null = null;
  if (opts.cursor) {
    after = decodeUsernameCursor(opts.cursor);
    if (!after) return 'invalid_cursor';
  }
  const pattern = opts.q ? `%${escapeLike(opts.q)}%` : null;
  const rows = await db
    .select({ user: users, acceptedAt: friendships.acceptedAt, updatedAt: friendships.updatedAt })
    .from(friendships)
    .innerJoin(users, sql`${users.id} = ${otherSideOf(userId)}`)
    .where(and(
      eq(friendships.status, 'accepted'),
      or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId)),
      after ? sql`lower(${users.username}) > ${after}` : undefined,
      pattern ? sql`(lower(${users.username}) like ${pattern} or lower(${users.displayName}) like ${pattern})` : undefined,
    ))
    .orderBy(sql`lower(${users.username})`)
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  return {
    items: page.map((r) => ({ user: toSocialUser(r.user), at: (r.acceptedAt ?? r.updatedAt).toISOString() })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE ? page[page.length - 1]!.user.username.toLowerCase() : null,
  };
}

/** Pending requests, newest first. `incoming` = someone else asked the
 * caller; `outgoing` = the caller asked someone else. */
export async function listFriendRequests(userId: string, direction: 'incoming' | 'outgoing', cursorRaw?: string): Promise<SocialPage | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const ts = microsecondIso(friendships.updatedAt);
  const rows = await db
    .select({ user: users, ts, id: friendships.id })
    .from(friendships)
    .innerJoin(users, sql`${users.id} = ${otherSideOf(userId)}`)
    .where(and(
      eq(friendships.status, 'pending'),
      or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId)),
      direction === 'outgoing' ? eq(friendships.requestedBy, userId) : sql`${friendships.requestedBy} <> ${userId}`,
      cursor ? sql`(${friendships.updatedAt}, ${friendships.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(friendships.updatedAt), desc(friendships.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ user: toSocialUser(r.user), at: r.ts })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.id) : null,
  };
}

export async function countIncomingRequests(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'pending'),
      or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId)),
      sql`${friendships.requestedBy} <> ${userId}`,
    ));
  return row?.n ?? 0;
}

/** The viewer's relation to `targetId`, as shown on a profile or a DM. A
 * block by the TARGET is reported as plain `none` — never reveal a reverse
 * block (docs/plano-rede-social.md §5.4). */
export async function getRelationship(viewerId: string, targetId: string): Promise<{ relation: Relation; retryAfter: string | null }> {
  if (viewerId === targetId) return { relation: 'self', retryAfter: null };
  if (await isBlocked(viewerId, targetId)) return { relation: 'blocked', retryAfter: null };
  if (await isBlocked(targetId, viewerId)) return { relation: 'none', retryAfter: null };
  const row = await getFriendship(viewerId, targetId);
  if (!row) return { relation: 'none', retryAfter: null };
  if (row.status === 'accepted') return { relation: 'friends', retryAfter: null };
  if (row.status === 'pending') {
    return { relation: row.requestedBy === viewerId ? 'outgoing' : 'incoming', retryAfter: null };
  }
  return { relation: 'none', retryAfter: isWithinCooldown(row.retryAfter) ? row.retryAfter!.toISOString() : null };
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
  if (!target || target.status !== 'active' || target.id === fromUserId || await isBlockedEitherWay(fromUserId, target.id)) {
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
    const revokedInvitationIds = await revokePendingBetween(tx, userId, otherUserId);
    return { code: 'removed', friendship: row!, revokedInvitationIds };
  });
}
