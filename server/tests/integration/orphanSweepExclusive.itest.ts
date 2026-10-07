import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { SweepInProgressError, sweepOrphans } from '../../src/modules/attachments/orphanSweeper.js';
import { pool } from './helpers.js';

after(() => pool.end());

describe('orphan sweep exclusivity (real Postgres)', () => {
  it('two sweeps at once: one runs, the other is refused — and a later one runs again', async () => {
    const results = await Promise.allSettled([
      sweepOrphans({ dryRun: true, actor: null }),
      sweepOrphans({ dryRun: true, actor: null }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.ok(refused?.reason instanceof SweepInProgressError);

    const again = await sweepOrphans({ dryRun: true, actor: null });
    assert.equal(again.dryRun, true);
  });
});
