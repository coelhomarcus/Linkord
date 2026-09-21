import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { reports, users } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { isActionAllowedFor, isClosed, resolutionFor, type ReportAction, type ReportTargetType } from '../reports/reportsPolicy.js';
import { suspendUser } from './adminUsers.js';
import { suspendGroup } from './adminGroups.js';
import { deleteMessageAsAdmin } from './adminMessages.js';
import { listAudit, recordAudit, type AuditActor } from './auditLog.js';

interface Ctx { actor: AuditActor; reason: string; requestId: string }

export type ReportActionResult =
  | { code: 'ok' }
  | { code: 'not_found' | 'already_closed' | 'invalid_action' | 'action_failed' | 'not_open'; detail?: string };

const createdAtIso = sql<string>`to_char(${reports.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const reporterName = sql<string | null>`(select u.username from users u where u.id = ${reports.reporterId})`;
const assigneeName = sql<string | null>`(select u.username from users u where u.id = ${reports.assigneeId})`;

export interface AdminReportRow {
  id: string; targetType: string; targetId: string; targetLabel: string; category: string; status: string;
  reporter: string | null; assignee: string | null; createdAt: string;
}

const listSelect = { report: reports, ts: createdAtIso, reporter: reporterName, assignee: assigneeName };
function toRow(r: { report: typeof reports.$inferSelect; ts: string; reporter: string | null; assignee: string | null }): AdminReportRow {
  return {
    id: r.report.id, targetType: r.report.targetType, targetId: r.report.targetId, targetLabel: r.report.targetLabel,
    category: r.report.category, status: r.report.status, reporter: r.reporter, assignee: r.assignee, createdAt: r.ts,
  };
}

export async function listAdminReports(filters: { status?: string; targetType?: string }, cursorRaw?: string): Promise<{ items: AdminReportRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const rows = await db.select(listSelect).from(reports)
    .where(and(
      // 'closed' = resolved + dismissed, the queue's "done" view
      filters.status === 'closed' ? inArray(reports.status, ['resolved', 'dismissed'])
        : filters.status && ['open', 'reviewing', 'resolved', 'dismissed'].includes(filters.status) ? eq(reports.status, filters.status) : undefined,
      filters.targetType && ['user', 'group', 'message'].includes(filters.targetType) ? eq(reports.targetType, filters.targetType) : undefined,
      cursor ? sql`(${reports.createdAt}, ${reports.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return { items: page.map(toRow), nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.report.id) : null };
}

/** Opening a report's evidence is itself an audited act (§6.5). */
export async function getAdminReport(ctx: { actor: AuditActor; requestId: string }, reportId: string) {
  const [row] = await db.select(listSelect).from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!row) return null;
  await recordAudit({ actor: ctx.actor, action: 'report.view', targetType: 'report', targetId: reportId, targetLabel: row.report.targetLabel, requestId: ctx.requestId });
  const history = await listAudit({ targetType: 'report', targetId: reportId });
  return {
    report: {
      ...toRow(row), details: row.report.details, snapshot: row.report.snapshot, resolution: row.report.resolution,
      resolutionNote: row.report.resolutionNote, resolvedAt: row.report.resolvedAt ? row.report.resolvedAt.toISOString() : null,
    },
    history: history === 'invalid_cursor' ? [] : history.items.filter((h) => h.action !== 'report.view'),
  };
}

export async function claimReport(ctx: Ctx, reportId: string): Promise<ReportActionResult> {
  return db.transaction(async (tx): Promise<ReportActionResult> => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for('update').limit(1);
    if (!report) return { code: 'not_found' };
    if (report.status !== 'open') return { code: isClosed(report.status) ? 'already_closed' : 'not_open' };
    await tx.update(reports).set({ status: 'reviewing', assigneeId: ctx.actor.id }).where(eq(reports.id, reportId));
    await recordAudit({ actor: ctx.actor, action: 'report.claim', targetType: 'report', targetId: reportId, targetLabel: report.targetLabel, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok' };
  });
}

/** Closes a report, optionally after applying an action through the SAME
 * audited commands used elsewhere (suspend, delete message). The action runs
 * first: if it fails the report stays open, so a report is never marked as
 * acted on when nothing happened. Never automatic — an admin always chooses. */
export async function resolveReport(ctx: Ctx, reportId: string, input: { dismiss: boolean; action: ReportAction | null }): Promise<ReportActionResult> {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report) return { code: 'not_found' };
  if (isClosed(report.status)) return { code: 'already_closed' };

  let action = input.dismiss ? null : input.action;
  if (action && !isActionAllowedFor(report.targetType as ReportTargetType, action)) return { code: 'invalid_action' };

  if (action) {
    const outcome = await applyAction(ctx, report, action);
    // "already suspended" means the goal is met; anything else is a real failure
    if (outcome !== 'ok' && outcome !== 'already_suspended') return { code: 'action_failed', detail: outcome };
  }

  await db.transaction(async (tx) => {
    await tx.update(reports).set({
      status: input.dismiss ? 'dismissed' : 'resolved', resolution: resolutionFor(action), resolutionNote: ctx.reason,
      resolvedAt: new Date(), assigneeId: report.assigneeId ?? ctx.actor.id,
    }).where(eq(reports.id, reportId));
    await recordAudit({
      actor: ctx.actor, action: input.dismiss ? 'report.dismiss' : 'report.resolve', targetType: 'report', targetId: reportId,
      targetLabel: report.targetLabel, reason: ctx.reason, detail: { resolution: resolutionFor(action) }, requestId: ctx.requestId,
    }, tx);
  });
  return { code: 'ok' };
}

async function applyAction(ctx: Ctx, report: typeof reports.$inferSelect, action: ReportAction): Promise<string> {
  const actionCtx = { actor: ctx.actor, reason: `Denúncia ${report.id}: ${ctx.reason}`.slice(0, 500), requestId: ctx.requestId };
  switch (action) {
    case 'suspend_group':
      return (await suspendGroup(actionCtx, report.targetId)).code;
    case 'delete_message':
      return (await deleteMessageAsAdmin(actionCtx, Number(report.targetId))).code;
    case 'suspend_user': {
      // for a message report the subject is whoever wrote it
      const userId = report.targetType === 'message' ? String((report.snapshot as { authorId?: string | null }).authorId ?? '') : report.targetId;
      if (!userId) return 'not_found';
      const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!exists) return 'not_found';
      return (await suspendUser(actionCtx, userId)).code;
    }
  }
}
