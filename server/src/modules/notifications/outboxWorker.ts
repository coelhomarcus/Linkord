import { and, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications, outboxEvents } from '../../db/schema.js';
import { notifySocialChanged } from '../presence/knownPeers.js';
import { OUTBOX_BATCH, OUTBOX_MAX_ATTEMPTS, OUTBOX_RETENTION_DAYS, NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS, daysAgo, nextOutboxState } from './notificationsPolicy.js';

/** Drains one batch of the transactional outbox. Rows are claimed with
 * FOR UPDATE SKIP LOCKED, so two workers (or two instances later) never take
 * the same event. Delivery is a re-emission of the payload-free `social-changed`
 * hint to the event's audience: the direct emit at the time of the change
 * already reached whoever was online, this is the safety net for an emit that
 * was lost — and it re-validates nothing it doesn't need to, because the hint
 * carries no data; the client refetches what it is allowed to see. */
export async function drainOutbox(): Promise<{ processed: number; failed: number }> {
  return db.transaction(async (tx) => {
    const batch = await tx.select().from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.attempts, OUTBOX_MAX_ATTEMPTS)))
      .orderBy(outboxEvents.createdAt)
      .limit(OUTBOX_BATCH)
      .for('update', { skipLocked: true });
    let processed = 0;
    let failed = 0;
    for (const event of batch) {
      let delivered = true;
      try {
        notifySocialChanged([event.audienceUserId]);
      } catch {
        delivered = false;
      }
      const state = nextOutboxState(event.attempts, delivered);
      await tx.update(outboxEvents)
        .set({ attempts: state.attempts, processedAt: state.processed ? new Date() : null })
        .where(sql`${outboxEvents.id} = ${event.id}`);
      if (state.processed) processed++; else failed++;
    }
    return { processed, failed };
  });
}

/** Retention (docs/plano-rede-social.md §10): read notifications and processed
 * outbox rows don't need to live forever. Unread ones are kept much longer. */
export async function pruneNotifications(now = new Date()): Promise<{ notifications: number; outbox: number }> {
  const readCut = daysAgo(NOTIFICATION_READ_RETENTION_DAYS, now);
  const unreadCut = daysAgo(NOTIFICATION_UNREAD_RETENTION_DAYS, now);
  const outboxCut = daysAgo(OUTBOX_RETENTION_DAYS, now);
  const oldRead = await db.delete(notifications)
    .where(sql`${notifications.readAt} is not null and ${notifications.readAt} < ${readCut.toISOString()}::timestamptz`).returning({ id: notifications.id });
  const oldUnread = await db.delete(notifications)
    .where(and(isNull(notifications.readAt), lt(notifications.createdAt, unreadCut))).returning({ id: notifications.id });
  const oldOutbox = await db.delete(outboxEvents)
    .where(sql`${outboxEvents.processedAt} is not null and ${outboxEvents.processedAt} < ${outboxCut.toISOString()}::timestamptz`).returning({ id: outboxEvents.id });
  return { notifications: oldRead.length + oldUnread.length, outbox: oldOutbox.length };
}

export async function outboxStats(): Promise<{ pending: number; failed: number }> {
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null and ${outboxEvents.attempts} < ${OUTBOX_MAX_ATTEMPTS})::int`,
    failed: sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null and ${outboxEvents.attempts} >= ${OUTBOX_MAX_ATTEMPTS})::int`,
  }).from(outboxEvents);
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}

