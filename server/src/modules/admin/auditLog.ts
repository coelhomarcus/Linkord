import crypto from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { adminAuditLogs } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import type { Tx } from '../users/userPairLock.js';

// Append-only trail of administrative actions (docs/plano-rede-social.md
// §6.5). Nothing in the application updates or deletes these rows, and there
// is no route that could. Never put passwords, cookies, tokens or message
// bodies in `detail`.

export interface AuditActor { id: string; username: string }

export interface AuditEntry {
  actor: AuditActor | null;
  action: string;
  targetType: 'user' | 'group' | 'message' | 'report' | 'system';
  targetId?: string;
  targetLabel?: string;
  reason?: string;
  result?: 'ok' | 'failed';
  detail?: Record<string, unknown>;
  requestId?: string;
}

/** Pass `tx` to record inside the same transaction as the change itself, so
 * an effective change can never exist without its trail. */
export async function recordAudit(entry: AuditEntry, executor: Tx | typeof db = db): Promise<void> {
  await executor.insert(adminAuditLogs).values({
    id: crypto.randomUUID(),
    actorId: entry.actor?.id ?? null,
    actorLabel: entry.actor?.username ?? '',
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? '',
    targetLabel: entry.targetLabel ?? '',
    reason: entry.reason ?? '',
    result: entry.result ?? 'ok',
    detail: entry.detail ?? {},
    requestId: entry.requestId ?? '',
  });
}

/** A failed follow-up (SFU eviction, file cleanup) must not undo the change,
 * but it must not vanish either. Never throws. */
export async function recordAuditFailure(entry: AuditEntry, error: unknown): Promise<void> {
  try {
    await recordAudit({ ...entry, result: 'failed', detail: { ...entry.detail, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) } });
  } catch (err) {
    console.error('[audit] could not record a failure entry:', err instanceof Error ? err.stack : err);
  }
}

const createdAtIso = sql<string>`to_char(${adminAuditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface AuditFilters {
  actor?: string; // actor id or username snapshot
  targetType?: string;
  targetId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditRow {
  id: string;
  at: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string;
  result: string;
  detail: Record<string, unknown>;
  requestId: string;
}

const isoDate = (raw: string | undefined): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function listAudit(filters: AuditFilters, cursorRaw?: string): Promise<{ items: AuditRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const rows = await db
    .select({ row: adminAuditLogs, ts: createdAtIso })
    .from(adminAuditLogs)
    .where(and(
      filters.actor ? sql`(${adminAuditLogs.actorId} = ${filters.actor} or lower(${adminAuditLogs.actorLabel}) = ${filters.actor.toLowerCase()})` : undefined,
      filters.targetType ? eq(adminAuditLogs.targetType, filters.targetType) : undefined,
      filters.targetId ? eq(adminAuditLogs.targetId, filters.targetId) : undefined,
      filters.action ? eq(adminAuditLogs.action, filters.action) : undefined,
      from ? sql`${adminAuditLogs.createdAt} >= ${from.toISOString()}::timestamptz` : undefined,
      to ? sql`${adminAuditLogs.createdAt} < ${to.toISOString()}::timestamptz` : undefined,
      cursor ? sql`(${adminAuditLogs.createdAt}, ${adminAuditLogs.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ row, ts }) => ({
      id: row.id, at: ts, actorId: row.actorId, actorLabel: row.actorLabel, action: row.action,
      targetType: row.targetType, targetId: row.targetId, targetLabel: row.targetLabel, reason: row.reason,
      result: row.result, detail: row.detail, requestId: row.requestId,
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.row.id) : null,
  };
}
