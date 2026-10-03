import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupReactionRows } from '../../../src/modules/messages/reactions.js';

describe('groupReactionRows', () => {
  test('empty list becomes empty map', () => {
    assert.deepEqual(groupReactionRows([]), new Map());
  });

  test('one message, one emoji, one user', () => {
    const map = groupReactionRows([{ messageId: 1, userId: 'u1', emoji: '👍' }]);
    assert.deepEqual(map, new Map([[1, { '👍': ['u1'] }]]));
  });

  test('one message, several different emojis', () => {
    const map = groupReactionRows([
      { messageId: 1, userId: 'u1', emoji: '👍' },
      { messageId: 1, userId: 'u1', emoji: '❤️' },
    ]);
    assert.deepEqual(map, new Map([[1, { '👍': ['u1'], '❤️': ['u1'] }]]));
  });

  test('several users on the same (message, emoji) preserve arrival order', () => {
    const map = groupReactionRows([
      { messageId: 1, userId: 'u2', emoji: '👍' },
      { messageId: 1, userId: 'u1', emoji: '👍' },
    ]);
    assert.deepEqual(map.get(1), { '👍': ['u2', 'u1'] });
  });

  test('different messages land in separate map entries', () => {
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
