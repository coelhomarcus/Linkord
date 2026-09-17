import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupReactionRows } from '../../../src/modules/messages/reactions.js';

describe('groupReactionRows', () => {
  test('lista vazia vira mapa vazio', () => {
    assert.deepEqual(groupReactionRows([]), new Map());
  });

  test('uma mensagem, um emoji, um usuario', () => {
    const map = groupReactionRows([{ messageId: 1, userId: 'u1', emoji: '👍' }]);
    assert.deepEqual(map, new Map([[1, { '👍': ['u1'] }]]));
  });

  test('uma mensagem, varios emojis diferentes', () => {
    const map = groupReactionRows([
      { messageId: 1, userId: 'u1', emoji: '👍' },
      { messageId: 1, userId: 'u1', emoji: '❤️' },
    ]);
    assert.deepEqual(map, new Map([[1, { '👍': ['u1'], '❤️': ['u1'] }]]));
  });

  test('varios usuarios no mesmo (mensagem, emoji) preservam a ordem de chegada', () => {
    const map = groupReactionRows([
      { messageId: 1, userId: 'u2', emoji: '👍' },
      { messageId: 1, userId: 'u1', emoji: '👍' },
    ]);
    assert.deepEqual(map.get(1), { '👍': ['u2', 'u1'] });
  });

  test('varias mensagens ficam em entradas separadas do mapa', () => {
    const map = groupReactionRows([
      { messageId: 1, userId: 'u1', emoji: '👍' },
      { messageId: 2, userId: 'u1', emoji: '😂' },
    ]);
    assert.deepEqual(map, new Map([
      [1, { '👍': ['u1'] }],
      [2, { '😂': ['u1'] }],
    ]));
  });
});
