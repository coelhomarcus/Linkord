import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkBlocked, recordFailure, reset } from './ratelimit.js';

// chave unica por teste (Math.random) — failuresByKey e um Map module-level
// compartilhado entre todos os testes deste processo, mesmo padrao ja usado
// pelos testes de isRateLimited em link-preview.test.ts.
function uniqueKey(): string {
  return `k-${Math.random()}`;
}

describe('checkBlocked / recordFailure', () => {
  test('chave nova (sem falha nenhuma) comeca liberada', () => {
    assert.equal(checkBlocked(uniqueKey()), null);
  });

  test('menos que o teto de falhas continua liberado', () => {
    const key = uniqueKey();
    for (let i = 0; i < 9; i++) recordFailure(key);
    assert.equal(checkBlocked(key), null);
  });

  test('atingir o teto de falhas bloqueia, devolvendo segundos ate poder tentar de novo', () => {
    const key = uniqueKey();
    for (let i = 0; i < 10; i++) recordFailure(key);
    const blockedSec = checkBlocked(key);
    assert.notEqual(blockedSec, null);
    assert.ok(blockedSec! > 0 && blockedSec! <= 15 * 60);
  });

  test('chaves diferentes nao se afetam', () => {
    const key1 = uniqueKey();
    const key2 = uniqueKey();
    for (let i = 0; i < 10; i++) recordFailure(key1);
    assert.notEqual(checkBlocked(key1), null);
    assert.equal(checkBlocked(key2), null);
  });
});

describe('reset', () => {
  test('libera uma chave bloqueada', () => {
    const key = uniqueKey();
    for (let i = 0; i < 10; i++) recordFailure(key);
    assert.notEqual(checkBlocked(key), null);
    reset(key);
    assert.equal(checkBlocked(key), null);
  });

  test('resetar uma chave que nunca falhou e no-op seguro', () => {
    assert.doesNotThrow(() => reset(uniqueKey()));
  });
});
