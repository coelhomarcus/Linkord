import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH } from '../../../src/modules/auth/password.js';

describe('hashPassword / verifyPassword', () => {
  test('the right password verifies true', async () => {
    const hash = await hashPassword('correta-123');
    assert.equal(await verifyPassword('correta-123', hash), true);
  });

  test('the wrong password verifies false', async () => {
    const hash = await hashPassword('correta-123');
    assert.equal(await verifyPassword('errada-456', hash), false);
  });

  test('the hash has the format scrypt$N$r$p$salt$hash', async () => {
    const hash = await hashPassword('qualquer');
    const parts = hash.split('$');
    assert.equal(parts.length, 6);
    assert.equal(parts[0], 'scrypt');
  });

  test('two identical passwords produce different hashes (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('mesma-senha'), hashPassword('mesma-senha')]);
    assert.notEqual(a, b);
  });

  test('never throws against a corrupted hash/unknown format — just fails verification', async () => {
    await assert.doesNotReject(async () => {
      const ok = await verifyPassword('qualquer', 'nao-e-um-hash-scrypt');
      assert.equal(ok, false);
    });
    await assert.doesNotReject(async () => {
      assert.equal(await verifyPassword('qualquer', null), false);
    });
    await assert.doesNotReject(async () => {
      assert.equal(await verifyPassword('qualquer', undefined), false);
    });
  });

  test('rejects absurd N/r/p parameters (protection against DoS via a corrupted row)', async () => {
    // N above the ceiling (2**20) — if it weren't blocked, it would try to
    // allocate memory/CPU far beyond reasonable just to verify one password.
    const forged = `scrypt$${2 ** 21}$8$1$${'a'.repeat(22)}$${'b'.repeat(86)}`;
    assert.equal(await verifyPassword('qualquer', forged), false);
  });

  test('DUMMY_HASH has the same format as a real hash, but never matches any password', async () => {
    const parts = DUMMY_HASH.split('$');
    assert.equal(parts.length, 6);
    assert.equal(parts[0], 'scrypt');
    assert.equal(await verifyPassword('qualquer-coisa', DUMMY_HASH), false);
  });
});

describe('needsRehash', () => {
  test('a hash with the current N does not need a rehash', async () => {
    const hash = await hashPassword('senha');
    assert.equal(needsRehash(hash), false);
  });

  test('a hash with a weaker N than the current one needs a rehash', () => {
    assert.equal(needsRehash('scrypt$1024$8$1$c2FsdA$aGFzaA'), true);
  });

  test('unknown/empty format counts as "needs rehash" (fail safe)', () => {
    assert.equal(needsRehash('lixo'), true);
    assert.equal(needsRehash(null), true);
    assert.equal(needsRehash(undefined), true);
  });
});
