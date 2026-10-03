import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeTimeCursor, decodeUsernameCursor, encodeTimeCursor, escapeLike, normalizeSearchQuery, MAX_SEARCH_LEN,
} from '../../../src/modules/friendships/cursor.js';

const TS = '2026-09-18T18:16:13.592123Z';
const ID = '9a26e8d3-7b27-4d77-aa4b-4aeea422fc7d';

describe('time cursor (requests/blocks)', () => {
  it('round trip preserves the timestamp with microseconds', () => {
    assert.deepEqual(decodeTimeCursor(encodeTimeCursor(TS, ID)), { ts: TS, id: ID });
  });

  it('rejects garbage instead of guessing', () => {
    for (const bad of ['', 'abc', `${TS}`, `_${ID}`, `${TS}_`, `2026-09-18_${ID}`, `${TS}_ id with space`, `${TS}_'; drop table users;--`]) {
      assert.equal(decodeTimeCursor(bad), null, bad);
    }
  });

  it('rejects a timestamp without 6 digits (milliseconds-only would drop rows in pagination)', () => {
    assert.equal(decodeTimeCursor(`2026-09-18T18:16:13.592Z_${ID}`), null);
  });
});

describe('username cursor (friends)', () => {
  it('normalizes to lowercase', () => {
    assert.equal(decodeUsernameCursor('Lune_99'), 'lune_99');
  });

  it('rejects characters outside the username alphabet and absurd lengths', () => {
    assert.equal(decodeUsernameCursor(''), null);
    assert.equal(decodeUsernameCursor('a b'), null);
    assert.equal(decodeUsernameCursor("x'--"), null);
    assert.equal(decodeUsernameCursor('a'.repeat(33)), null);
  });
});

describe('escapeLike / normalizeSearchQuery', () => {
  it('escapes %, _ and \\ to match them literally', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  });

  it('the search term is trimmed, lowercased and capped', () => {
    assert.equal(normalizeSearchQuery('  LuNe '), 'lune');
    assert.equal(normalizeSearchQuery(undefined), '');
    assert.equal(normalizeSearchQuery('x'.repeat(500)).length, MAX_SEARCH_LEN);
  });
});
