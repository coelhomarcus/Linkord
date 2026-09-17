import { isNotNull, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable } from '../../db/schema.js';
import { broadcast } from '../presence/participants.js';

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

export async function broadcastUsage(): Promise<void> {
  broadcast({ t: 'storage-usage', ...(await getUsage()) });
}
