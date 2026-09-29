import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalUserPair } from '../../../src/modules/users/userPairLock.js';

describe('canonicalUserPair', () => {
  it('orders the pair deterministically, regardless of input order', () => {
    assert.deepEqual(canonicalUserPair('a', 'b'), ['a', 'b']);
    assert.deepEqual(canonicalUserPair('b', 'a'), ['a', 'b']);
  });

  it('does not depend on real lexicographic meaning — just consistency', () => {
    const [low, high] = canonicalUserPair('user-99', 'user-1');
    assert.equal(low < high, true);
  });
});
