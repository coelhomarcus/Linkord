import { eq, isNotNull, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, messages } from '../../db/schema.js';
import { sendToUser } from '../presence/participants.js';

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Always computed live (sum/count the table) — never drifts from disk.
 * Only counts chat attachments (messageId set); avatars are excluded from
 * the 30GB quota on purpose. */
export async function getUsage(): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(attachmentsTable)
    .where(isNotNull(attachmentsTable.messageId));
  return { totalBytes: Number(row!.totalBytes), totalFiles: Number(row!.totalFiles), maxBytes: config.MAX_STORAGE_BYTES };
}

/** The figure an ordinary account sees: ITS OWN storage against ITS OWN
 * quota. The instance-wide total is an administrative number (§8.3) and is
 * no longer sent to everyone. */
export async function getUserUsage(userId: string): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)::float8`, totalFiles: sql<number>`count(${attachmentsTable.id})::int` })
    .from(attachmentsTable)
    .innerJoin(messages, eq(messages.id, attachmentsTable.messageId))
    .where(eq(messages.authorId, userId));
  return { totalBytes: Number(row?.totalBytes ?? 0), totalFiles: Number(row?.totalFiles ?? 0), maxBytes: config.MAX_USER_STORAGE_BYTES };
}

/** Tells one account how much of its quota is used (after an upload, or after
 * one of its messages with files was deleted). */
export async function sendUsageToUser(userId: string): Promise<void> {
  sendToUser(userId, { t: 'storage-usage', ...(await getUserUsage(userId)) });
}
