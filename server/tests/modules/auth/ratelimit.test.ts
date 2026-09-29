import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkBlocked, recordFailure, reset } from '../../../src/modules/auth/ratelimit.js';

// unique key per test (Math.random) — failuresByKey is a module-level Map
// shared across all tests in this process, the same pattern already used by
// the isRateLimited tests in link-preview.test.ts.
function uniqueKey(): string {
  return `k-${Math.random()}`;
}

describe('checkBlocked / recordFailure', () => {
  test('a brand new key (no failures yet) starts unblocked', () => {
    assert.equal(checkBlocked(uniqueKey()), null);
  });

  test('fewer than the failure ceiling stays unblocked', () => {
    const key = uniqueKey();
    for (let i = 0; i < 9; i++) recordFailure(key);
    assert.equal(checkBlocked(key), null);
  });

  test('hitting the failure ceiling blocks, returning seconds until it can be tried again', () => {
    const key = uniqueKey();
    for (let i = 0; i < 10; i++) recordFailure(key);
    const blockedSec = checkBlocked(key);
    assert.notEqual(blockedSec, null);
    assert.ok(blockedSec! > 0 && blockedSec! <= 15 * 60);
  });

  test('different keys do not affect each other', () => {
    const key1 = uniqueKey();
    const key2 = uniqueKey();
    for (let i = 0; i < 10; i++) recordFailure(key1);
    assert.notEqual(checkBlocked(key1), null);
    assert.equal(checkBlocked(key2), null);
  });
});

describe('reset', () => {
  test('unblocks a blocked key', () => {
    const key = uniqueKey();
    for (let i = 0; i < 10; i++) recordFailure(key);
    assert.notEqual(checkBlocked(key), null);
    reset(key);
    assert.equal(checkBlocked(key), null);
  });

  test('resetting a key that never failed is a safe no-op', () => {
    assert.doesNotThrow(() => reset(uniqueKey()));
  });
});
