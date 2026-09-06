import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { clearWsRateLimits, consumeWsEvent } from './rateLimit.js';

afterEach(clearWsRateLimits);

describe('consumeWsEvent', () => {
  test('permite eventos abaixo do limite e bloqueia o seguinte', () => {
    for (let i = 0; i < 12; i += 1) {
      assert.equal(consumeWsEvent('user-1', 'chat', 1_000 + i), null);
    }
    assert.equal(consumeWsEvent('user-1', 'chat', 2_000), 9);
  });

  test('compartilha o limite entre eventos do mesmo grupo', () => {
    for (let i = 0; i < 30; i += 1) {
      const event = i % 2 === 0 ? 'reaction' : 'chat-react';
      assert.equal(consumeWsEvent('user-1', event, 1_000 + i), null);
    }
    assert.ok(consumeWsEvent('user-1', 'reaction', 2_000));
  });

  test('usuarios diferentes nao compartilham limite', () => {
    for (let i = 0; i < 12; i += 1) consumeWsEvent('user-1', 'chat', 1_000 + i);
    assert.equal(consumeWsEvent('user-2', 'chat', 2_000), null);
  });

  test('libera novamente depois da janela', () => {
    for (let i = 0; i < 12; i += 1) consumeWsEvent('user-1', 'chat', 1_000 + i);
    assert.equal(consumeWsEvent('user-1', 'chat', 12_000), null);
  });
});
