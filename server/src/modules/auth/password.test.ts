import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH } from './password.js';

describe('hashPassword / verifyPassword', () => {
  test('senha certa verifica true', async () => {
    const hash = await hashPassword('correta-123');
    assert.equal(await verifyPassword('correta-123', hash), true);
  });

  test('senha errada verifica false', async () => {
    const hash = await hashPassword('correta-123');
    assert.equal(await verifyPassword('errada-456', hash), false);
  });

  test('hash tem o formato scrypt$N$r$p$salt$hash', async () => {
    const hash = await hashPassword('qualquer');
    const parts = hash.split('$');
    assert.equal(parts.length, 6);
    assert.equal(parts[0], 'scrypt');
  });

  test('duas senhas iguais geram hashes diferentes (salt aleatorio)', async () => {
    const [a, b] = await Promise.all([hashPassword('mesma-senha'), hashPassword('mesma-senha')]);
    assert.notEqual(a, b);
  });

  test('nunca lanca contra um hash corrompido/formato desconhecido — so falha a verificacao', async () => {
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

  test('rejeita parametros N/r/p absurdos (protecao contra DoS via linha corrompida)', async () => {
    // N acima do teto (2**20) — se nao fosse bloqueado, tentaria alocar
    // memoria/CPU muito alem do razoavel so pra verificar uma senha.
    const forged = `scrypt$${2 ** 21}$8$1$${'a'.repeat(22)}$${'b'.repeat(86)}`;
    assert.equal(await verifyPassword('qualquer', forged), false);
  });

  test('DUMMY_HASH tem o mesmo formato de um hash real, mas nunca bate com nenhuma senha', async () => {
    const parts = DUMMY_HASH.split('$');
    assert.equal(parts.length, 6);
    assert.equal(parts[0], 'scrypt');
    assert.equal(await verifyPassword('qualquer-coisa', DUMMY_HASH), false);
  });
});

describe('needsRehash', () => {
  test('hash com N atual nao precisa rehash', async () => {
    const hash = await hashPassword('senha');
    assert.equal(needsRehash(hash), false);
  });

  test('hash com N mais fraco que o atual precisa rehash', () => {
    assert.equal(needsRehash('scrypt$1024$8$1$c2FsdA$aGFzaA'), true);
  });

  test('formato desconhecido/vazio conta como "precisa rehash" (fail safe)', () => {
    assert.equal(needsRehash('lixo'), true);
    assert.equal(needsRehash(null), true);
    assert.equal(needsRehash(undefined), true);
  });
});
