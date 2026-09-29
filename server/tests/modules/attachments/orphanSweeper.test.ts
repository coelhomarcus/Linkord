import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyOrphans } from '../../../src/modules/attachments/orphanSweeper.js';

const HOUR = 60 * 60 * 1000;
const NOW = 1_000_000 * HOUR;
const GRACE = 24 * HOUR;
const file = (name: string, ageHours: number, size = 10) => ({ name, size, mtimeMs: NOW - ageHours * HOUR });

describe('classifyOrphans', () => {
  it('a file with a DB record is never an orphan, no matter how old', () => {
    const r = classifyOrphans({ files: [file('a', 500)], dbIds: new Set(['a']), now: NOW, graceMs: GRACE });
    assert.equal(r.orphans.length, 0);
    assert.equal(r.tracked, 1);
  });

  it('no record and older than the grace period: orphan', () => {
    const r = classifyOrphans({ files: [file('x', 25)], dbIds: new Set(), now: NOW, graceMs: GRACE });
    assert.deepEqual(r.orphans.map((f) => f.name), ['x']);
  });

  it('no record but within the grace period: spared (an upload mid-commit)', () => {
    const r = classifyOrphans({ files: [file('x', 23)], dbIds: new Set(), now: NOW, graceMs: GRACE });
    assert.equal(r.orphans.length, 0);
    assert.equal(r.recent, 1);
  });

  it('a DB row with no file is only reported (missingFiles), never turns into an action', () => {
    const r = classifyOrphans({ files: [file('a', 1)], dbIds: new Set(['a', 'b', 'c']), now: NOW, graceMs: GRACE });
    assert.equal(r.missingFiles, 2);
    assert.equal(r.orphans.length, 0);
  });

  it('mixed set: only what is old and without a record gets collected', () => {
    const r = classifyOrphans({
      files: [file('tracked', 100), file('old-orphan', 100), file('new-orphan', 2)],
      dbIds: new Set(['tracked']), now: NOW, graceMs: GRACE,
    });
    assert.deepEqual(r.orphans.map((f) => f.name), ['old-orphan']);
    assert.equal(r.recent, 1);
    assert.equal(r.tracked, 1);
  });
});
