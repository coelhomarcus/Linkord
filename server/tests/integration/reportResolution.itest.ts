import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { eq, inArray, and } from 'drizzle-orm';
import { adminAuditLogs, reports, users } from '../../src/db/schema.js';
import { claimReport, resolveReport } from '../../src/modules/admin/adminReports.js';
import { db, makeUser, pool } from './helpers.js';

after(() => pool.end());

async function makeReport(reporterId: string, targetUserId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(reports).values({ id, reporterId, targetType: 'user', targetId: targetUserId, targetLabel: 'target', category: 'spam' });
  return id;
}

const ctx = (admin: { id: string; username: string }, reason = 'itest decision') => ({ actor: admin, reason, requestId: crypto.randomUUID() });

async function closingAudits(reportId: string): Promise<string[]> {
  const rows = await db.select({ action: adminAuditLogs.action }).from(adminAuditLogs)
    .where(and(eq(adminAuditLogs.targetType, 'report'), eq(adminAuditLogs.targetId, reportId), inArray(adminAuditLogs.action, ['report.resolve', 'report.dismiss'])));
  return rows.map((r) => r.action);
}

describe('report resolution under concurrency (real Postgres)', () => {
  it('one admin dismisses while another suspends the account: one outcome, and the account is suspended only if that outcome says so (15 rounds)', async () => {
    for (let round = 0; round < 15; round++) {
      const reporter = await makeUser('rep'); const target = await makeUser('tgt');
      const adminA = await makeUser('adma', 'admin'); const adminB = await makeUser('admb', 'admin');
      const reportId = await makeReport(reporter.id, target.id);

      const suspend = () => resolveReport(ctx(adminA), reportId, { dismiss: false, action: 'suspend_user' });
      const dismiss = () => resolveReport(ctx(adminB), reportId, { dismiss: true, action: null });
      const results = await Promise.all(round % 2 ? [suspend(), dismiss()] : [dismiss(), suspend()]);

      assert.equal(results.filter((r) => r.code === 'ok').length, 1, `round ${round}: ${JSON.stringify(results)}`);
      const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
      const [account] = await db.select({ status: users.status }).from(users).where(eq(users.id, target.id));
      assert.deepEqual((await closingAudits(reportId)).length, 1, `round ${round}: closing audit rows`);
      if (report!.status === 'dismissed') {
        assert.equal(account!.status, 'active', `round ${round}: dismissed, yet the account was suspended`);
        assert.equal(report!.resolution, 'no_action');
      } else {
        assert.equal(report!.status, 'resolved');
        assert.equal(report!.resolution, 'user_suspended');
        assert.equal(account!.status, 'suspended', `round ${round}: resolved as suspended, yet the account is active`);
      }
    }
  });

  it('two identical decisions: exactly one succeeds and the other is told it was not accepted', async () => {
    for (let round = 0; round < 10; round++) {
      const reporter = await makeUser('rep'); const target = await makeUser('tgt');
      const adminA = await makeUser('adma', 'admin'); const adminB = await makeUser('admb', 'admin');
      const reportId = await makeReport(reporter.id, target.id);
      const results = await Promise.all([adminA, adminB].map((admin) => resolveReport(ctx(admin), reportId, { dismiss: false, action: 'suspend_user' })));
      assert.equal(results.filter((r) => r.code === 'ok').length, 1, `round ${round}: ${JSON.stringify(results)}`);
      assert.ok(results.some((r) => r.code === 'already_closed' || r.code === 'busy'), `round ${round}: ${JSON.stringify(results)}`);
      assert.equal((await closingAudits(reportId)).length, 1);
    }
  });

  it('a decision after the report is closed is refused, and nothing is applied', async () => {
    const reporter = await makeUser('rep'); const target = await makeUser('tgt'); const admin = await makeUser('adm', 'admin');
    const reportId = await makeReport(reporter.id, target.id);
    assert.equal((await resolveReport(ctx(admin), reportId, { dismiss: true, action: null })).code, 'ok');
    assert.equal((await resolveReport(ctx(admin), reportId, { dismiss: false, action: 'suspend_user' })).code, 'already_closed');
    const [account] = await db.select({ status: users.status }).from(users).where(eq(users.id, target.id));
    assert.equal(account!.status, 'active');
  });

  it('a failed action leaves the report open and records no resolution', async () => {
    const reporter = await makeUser('rep'); const admin = await makeUser('adm', 'admin');
    // an admin cannot suspend their own account: the action fails
    const reportId = await makeReport(reporter.id, admin.id);
    const result = await resolveReport(ctx(admin), reportId, { dismiss: false, action: 'suspend_user' });
    assert.equal(result.code, 'action_failed');
    const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
    assert.equal(report!.status, 'open');
    assert.equal(report!.resolution, '');
    assert.equal((await closingAudits(reportId)).length, 0);
  });

  it('claim racing a resolution: the report ends closed, never back in review', async () => {
    for (let round = 0; round < 10; round++) {
      const reporter = await makeUser('rep'); const target = await makeUser('tgt');
      const adminA = await makeUser('adma', 'admin'); const adminB = await makeUser('admb', 'admin');
      const reportId = await makeReport(reporter.id, target.id);
      const ops = [
        () => resolveReport(ctx(adminA), reportId, { dismiss: true, action: null }),
        () => claimReport(ctx(adminB), reportId),
      ];
      await Promise.allSettled((round % 2 ? ops : [...ops].reverse()).map((op) => op()));
      const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
      assert.equal(report!.status, 'dismissed', `round ${round}: ended as ${report!.status}`);
    }
  });
});
