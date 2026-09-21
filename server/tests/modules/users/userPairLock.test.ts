import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalUserPair } from '../../../src/modules/users/userPairLock.js';

describe('canonicalUserPair', () => {
  it('ordena o par de forma determinística, independente da ordem de entrada', () => {
    assert.deepEqual(canonicalUserPair('a', 'b'), ['a', 'b']);
    assert.deepEqual(canonicalUserPair('b', 'a'), ['a', 'b']);
  });

  it('não depende de significado lexicográfico real — só de consistência', () => {
    const [low, high] = canonicalUserPair('user-99', 'user-1');
    assert.equal(low < high, true);
  });
});
