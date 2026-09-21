import { sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { notifications, users } from '../../db/schema.js';
import { getUsage } from '../attachments/attachmentQuota.js';
import { getLastSweep } from '../attachments/orphanSweeper.js';
import { outboxStats } from '../notifications/outboxWorker.js';
import { listOnlineUserIds, participants } from '../presence/participants.js';

/** Operational picture of the instance (docs/plano-rede-social.md §9
 * "Operação"): what an administrator needs to know to act, nothing decorative.
 * The instance-wide storage figure lives HERE and nowhere an ordinary account
 * can see it (§8.3). */
export async function getSystemInfo() {
  const [storage, outbox, accounts, unread] = await Promise.all([
    getUsage(),
    outboxStats(),
    db.select({
      total: sql<number>`count(*)::int`,
      lastHour: sql<number>`count(*) filter (where ${users.createdAt} >= ${new Date(Date.now() - 60 * 60 * 1000).toISOString()}::timestamptz)::int`,
      activeAdmins: sql<number>`count(*) filter (where ${users.role} = 'admin' and ${users.status} = 'active')::int`,
      suspended: sql<number>`count(*) filter (where ${users.status} = 'suspended')::int`,
    }).from(users),
    db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(sql`${notifications.readAt} is null`),
  ]);
  const acc = accounts[0];
  return {
    storage: { usedBytes: storage.totalBytes, files: storage.totalFiles, maxBytes: storage.maxBytes },
    connections: { live: participants.size, onlineAccounts: listOnlineUserIds().length, max: config.MAX_PARTICIPANTS, perAccountMax: config.MAX_CONNECTIONS_PER_USER },
    accounts: { total: acc?.total ?? 0, newLastHour: acc?.lastHour ?? 0, newPerHourCap: config.MAX_NEW_ACCOUNTS_PER_HOUR, activeAdmins: acc?.activeAdmins ?? 0, suspended: acc?.suspended ?? 0 },
    livekit: { configured: !!(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET) },
    outbox,
    notifications: { unread: unread[0]?.n ?? 0 },
    orphanSweep: { dryRunByDefault: config.ORPHAN_SWEEP_DRY_RUN, last: getLastSweep() },
  };
}
