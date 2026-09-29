import { describe, expect, it } from 'vitest';
import { isSingleEmoji } from '@/shared/lib/isSingleEmoji';

describe('isSingleEmoji', () => {
  it.each([
    ['😀', 'plain emoji'],
    ['🇧🇷', 'flag'],
    ['👍🏽', 'skin tone'],
    ['👨‍👩‍👧‍👦', 'ZWJ sequence'],
    ['1️⃣', 'keycap'],
    ['  😀\n', 'surrounding whitespace'],
  ])('accepts %s (%s)', (text) => {
    expect(isSingleEmoji(text)).toBe(true);
  });

  it.each([
    ['A', 'plain text'],
    ['😀 oi', 'emoji followed by text'],
    ['😀😀', 'two emoji'],
    ['©', 'symbol in text presentation'],
    ['🏽', 'isolated modifier'],
  ])('rejects %s (%s)', (text) => {
    expect(isSingleEmoji(text)).toBe(false);
  });
});
