import { eq, sql } from 'drizzle-orm';
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
 * Counts EVERYTHING, including avatars/banners/group avatars (messageId
 * null) — those used to be excluded on the theory that an account only ever
 * has one avatar + one banner at a time, so they don't accumulate the way
 * chat history does (see schema.ts#attachments). That's true for STEADY
 * storage, but it left this total (and therefore handleAvatarUpload, which
 * checks it) blind to write VOLUME — nothing stopped an account from
 * replacing its avatar as fast as the network allowed, and many accounts
 * doing that simultaneously does add up against the shared instance-wide
 * cap. Chat attachments still get their own PER-USER quota separately
 * (getUserUsage below, via the message's author) — this total is the
 * shared ceiling everyone draws from regardless of what kind of file it is. */
export async function getUsage(): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(attachmentsTable);
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
