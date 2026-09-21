import { gte, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import * as floodControl from '../../realtime/floodControl.js';

export type RegistrationGate = 'ok' | 'ip_limited' | 'paused';

const HOUR_MS = 60 * 60 * 1000;

/** Pure: does `recentAccounts` (created in the last hour) already trip the
 * instance-wide circuit breaker? */
export function isRegistrationPaused(recentAccounts: number, cap = config.MAX_NEW_ACCOUNTS_PER_HOUR): boolean {
  return recentAccounts >= cap;
}

/** Runs only after the code and the payload are valid, right before the
 * account is created, so a typo never spends the caller's budget. Two brakes:
 * a per-IP hourly cap, and an instance-wide cap on new accounts per hour (the
 * public sign-up must not be able to fill the room or the database faster
 * than someone can react). The DB count is the source of truth, so it
 * survives restarts and works across the deploy's processes. */
export async function checkRegistrationAllowed(ip: string): Promise<RegistrationGate> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
    .where(gte(users.createdAt, new Date(Date.now() - HOUR_MS)));
  if (isRegistrationPaused(row?.n ?? 0)) return 'paused';
  if (!floodControl.allow(`register:${ip}`, { windowMs: HOUR_MS, max: config.REGISTRATIONS_PER_IP_PER_HOUR })) return 'ip_limited';
  return 'ok';
}
