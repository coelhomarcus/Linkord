import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteChatMessage, sanitizeClientId, toggleMessageReaction } from './chat.js';

describe('canDeleteChatMessage', () => {
  test('autor pode apagar a propria mensagem', () => {
    assert.equal(canDeleteChatMessage({ userId: 'autor', role: 'user' }, 'autor'), true);
  });

  test('usuario comum nao pode apagar mensagem alheia ou sem autor', () => {
    assert.equal(canDeleteChatMessage({ userId: 'outro', role: 'user' }, 'autor'), false);
    assert.equal(canDeleteChatMessage({ userId: 'outro', role: 'user' }, null), false);
  });

  test('admin pode apagar qualquer mensagem, inclusive de conta removida', () => {
    assert.equal(canDeleteChatMessage({ userId: 'admin', role: 'admin' }, 'autor'), true);
    assert.equal(canDeleteChatMessage({ userId: 'admin', role: 'admin' }, null), true);
  });
});

describe('sanitizeClientId', () => {
  test('aceita uma string curta e devolve ela mesma (sem espacos nas pontas)', () => {
    assert.equal(sanitizeClientId('  abc-123  '), 'abc-123');
  });

  test('rejeita nao-string, vazio e string longa demais', () => {
    assert.equal(sanitizeClientId(undefined), undefined);
    assert.equal(sanitizeClientId(42), undefined);
    assert.equal(sanitizeClientId(''), undefined);
    assert.equal(sanitizeClientId('   '), undefined);
    assert.equal(sanitizeClientId('a'.repeat(101)), undefined);
  });
});

describe('toggleMessageReaction', () => {
  test('adiciona sem mutar o objeto/array original', () => {
    const original = { '👍': ['a'] };
    const next = toggleMessageReaction(original, '👍', 'b');
    assert.deepEqual(next, { '👍': ['a', 'b'] });
    assert.deepEqual(original, { '👍': ['a'] });
  });

  test('segundo toggle remove o usuario e apaga lista vazia', () => {
    assert.deepEqual(toggleMessageReaction({ '👍': ['a'] }, '👍', 'a'), {});
  });
});
