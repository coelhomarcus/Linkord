import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import type { Tx } from '../users/userPairLock.js';

// Leaf module (db/schema + cursor helpers only): friendships/ and conversations/
// call markNotificationsRead INSIDE their own transactions, so it must not
// depend on either of them.

/** Answering a request or an invitation settles its notification — nobody
 * should keep an unread "you have a request" for something already handled. */
export async function markNotificationsRead(tx: Tx | typeof db, ref: { friendshipId: string } | { invitationIds: string[] }): Promise<void> {
  if ('friendshipId' in ref) {
    await tx.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.friendshipId, ref.friendshipId), eq(notifications.kind, 'friend_request'), isNull(notifications.readAt)));
    return;
  }
  if (ref.invitationIds.length === 0) return;
  await tx.update(notifications).set({ readAt: new Date() })
    .where(and(inArray(notifications.groupInvitationId, ref.invitationIds), isNull(notifications.readAt)));
}

const createdAtIso = sql<string>`to_char(${notifications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface NotificationEntry {
  id: string; kind: string; at: string; read: boolean; friendshipId: string | null; invitationId: string | null;
}

/** The recipient's own notifications, newest first. Nobody else's are ever
 * reachable: the recipient comes from the session, never from the request. */
export async function listNotifications(userId: string, cursorRaw?: string): Promise<{ items: NotificationEntry[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const rows = await db.select({ row: notifications, ts: createdAtIso }).from(notifications)
    .where(and(
      eq(notifications.recipientId, userId),
      cursor ? sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ row, ts }) => ({
      id: row.id, kind: row.kind, at: ts, read: row.readAt !== null, friendshipId: row.friendshipId, invitationId: row.groupInvitationId,
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.row.id) : null,
  };
}

export async function countUnread(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Idempotent: ids that are already read, or belong to someone else, are simply skipped. */
export async function markRead(userId: string, ids: string[] | 'all'): Promise<number> {
  const scope = ids === 'all'
    ? and(eq(notifications.recipientId, userId), isNull(notifications.readAt))
    : and(eq(notifications.recipientId, userId), isNull(notifications.readAt), inArray(notifications.id, ids));
  if (ids !== 'all' && ids.length === 0) return 0;
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(scope).returning({ id: notifications.id });
  return rows.length;
}
