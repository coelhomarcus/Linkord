import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyOrphans } from '../../../src/modules/attachments/orphanSweeper.js';

const HOUR = 60 * 60 * 1000;
const NOW = 1_000_000 * HOUR;
const GRACE = 24 * HOUR;
const file = (name: string, ageHours: number, size = 10) => ({ name, size, mtimeMs: NOW - ageHours * HOUR });

describe('classifyOrphans', () => {
  it('arquivo com registro nunca e orfao, por mais velho que seja', () => {
    const r = classifyOrphans({ files: [file('a', 500)], dbIds: new Set(['a']), now: NOW, graceMs: GRACE });
    assert.equal(r.orphans.length, 0);
    assert.equal(r.tracked, 1);
  });

  it('sem registro e mais velho que a carencia: orfao', () => {
    const r = classifyOrphans({ files: [file('x', 25)], dbIds: new Set(), now: NOW, graceMs: GRACE });
    assert.deepEqual(r.orphans.map((f) => f.name), ['x']);
  });

  it('sem registro mas dentro da carencia: poupado (um upload em commit)', () => {
    const r = classifyOrphans({ files: [file('x', 23)], dbIds: new Set(), now: NOW, graceMs: GRACE });
    assert.equal(r.orphans.length, 0);
    assert.equal(r.recent, 1);
  });

  it('linha sem arquivo e so relatada (missingFiles), nunca vira acao', () => {
    const r = classifyOrphans({ files: [file('a', 1)], dbIds: new Set(['a', 'b', 'c']), now: NOW, graceMs: GRACE });
    assert.equal(r.missingFiles, 2);
    assert.equal(r.orphans.length, 0);
  });

  it('mistura: so o que e velho e sem registro e coletado', () => {
    const r = classifyOrphans({
      files: [file('tracked', 100), file('old-orphan', 100), file('new-orphan', 2)],
      dbIds: new Set(['tracked']), now: NOW, graceMs: GRACE,
    });
    assert.deepEqual(r.orphans.map((f) => f.name), ['old-orphan']);
    assert.equal(r.recent, 1);
    assert.equal(r.tracked, 1);
  });
});
