import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userBlocks, friendships, users } from '../../db/schema.js';
import { withUserPairLock } from '../users/userPairLock.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';

export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const [row] = await db.select({ blockerId: userBlocks.blockerId }).from(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId))).limit(1);
  return !!row;
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [row] = await db.select({ blockerId: userBlocks.blockerId }).from(userBlocks)
    .where(or(
      and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
      and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
    )).limit(1);
  return !!row;
}

/** Directional block. Idempotent (a repeat block is a no-op, not an error).
 * Ends any active/pending friendship for the pair in the SAME transaction
 * (docs/plano-rede-social.md §7.3) — reaches into the `friendships` table
 * directly rather than importing friendshipsRepository.ts, which would
 * create a cycle (that module imports this one for canSendDirectMessage).
 * Only the status transition is duplicated here, not the cooldown/version
 * bookkeeping a real friend-request rejection goes through — a block isn't
 * a request that could be retried, there's nothing to cool down. */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  await withUserPairLock(blockerId, blockedId, async (tx) => {
    await tx.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
    await tx.update(friendships)
      .set({ status: 'removed', respondedAt: new Date(), version: sql`${friendships.version} + 1` })
      .where(and(
        or(
          and(eq(friendships.userLowId, blockerId), eq(friendships.userHighId, blockedId)),
          and(eq(friendships.userLowId, blockedId), eq(friendships.userHighId, blockerId)),
        ),
        sql`${friendships.status} IN ('pending', 'accepted')`,
      ));
  });
}

export interface BlockEntry { user: SocialUser; at: string }

/** Accounts THIS user blocked, newest first (keyset pagination — see
 * friendships/cursor.ts). Only the blocker's own list: who blocked you is
 * never exposed. */
export async function listBlocks(blockerId: string, cursorRaw?: string): Promise<{ items: BlockEntry[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const ts = sql<string>`to_char(${userBlocks.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const rows = await db
    .select({ user: users, ts, id: userBlocks.blockedId })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(and(
      eq(userBlocks.blockerId, blockerId),
      cursor ? sql`(${userBlocks.createdAt}, ${userBlocks.blockedId}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(userBlocks.createdAt), desc(userBlocks.blockedId))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ user: toSocialUser(r.user), at: r.ts })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.id) : null,
  };
}

/** Unblocking never restores the friendship, invitations, or calls on its
 * own (docs/plano-rede-social.md §5.7/§7.3) — it only removes this row. */
export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
}
