import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { Queryable, RepairAction } from './legacyInventory.js';

// Applies a repair plan (legacyInventory.ts#planRepairs). Runs BEFORE the
// migrations that would fail on the data, so it talks to the database with plain
// SQL and creates its own log table if the schema does not have it yet.

export const ENSURE_REPAIRS_TABLE = `
create table if not exists data_repairs (
  id text primary key,
  run_id text not null,
  kind varchar(32) not null,
  target_type varchar(16) not null,
  target_id text not null,
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  note text not null default '',
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
)`;

export interface RepairRun {
  runId: string;
  applied: RepairAction[];
  /** the row changed since the plan was made, so it was left alone */
  skipped: { action: RepairAction; reason: string }[];
}

export class InjectedRepairFailure extends Error {}

/** All-or-nothing: one transaction, the affected groups locked (same convention
 * as every group operation), each row re-checked against what the plan saw. A
 * failure anywhere leaves no trace, so re-running is always safe and — the plan
 * being derived from current data — a finished run is followed by an empty plan.
 * `failAfter` exists only for the rehearsal, to prove exactly that. */
export async function applyRepairs(pool: Pool, actions: RepairAction[], opts: { failAfter?: number } = {}): Promise<RepairRun> {
  const runId = crypto.randomUUID();
  const run: RepairRun = { runId, applied: [], skipped: [] };
  if (actions.length === 0) return run;

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(ENSURE_REPAIRS_TABLE);
    const conversationIds = [...new Set(actions.map((a) => a.conversationId))].sort();
    await client.query('select id from conversations where id = any($1) order by id for update', [conversationIds]);

    for (const action of actions) {
      const current = await client.query<{ role: string }>(
        'select role from conversation_members where conversation_id = $1 and user_id = $2', [action.conversationId, action.userId]);
      if (current.rows[0]?.role !== action.before.role) {
        run.skipped.push({ action, reason: current.rows.length ? `papel atual "${current.rows[0]!.role}" difere do planejado` : 'membro não existe mais' });
        continue;
      }
      await client.query('update conversation_members set role = $3 where conversation_id = $1 and user_id = $2', [action.conversationId, action.userId, action.after.role]);
      await client.query(
        'insert into data_repairs (id, run_id, kind, target_type, target_id, before, after, note, needs_review) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [crypto.randomUUID(), runId, action.kind, 'group_member', `${action.conversationId}:${action.userId}`, JSON.stringify(action.before), JSON.stringify(action.after), action.note, action.needsReview]);
      run.applied.push(action);
      if (opts.failAfter !== undefined && run.applied.length >= opts.failAfter) throw new InjectedRepairFailure('falha injetada para o ensaio');
    }
    await client.query('commit');
    return run;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type { Queryable };
