import { describe, expect, it } from 'vitest';
import { isSingleEmoji } from '@/shared/lib/isSingleEmoji';

describe('isSingleEmoji', () => {
  it.each([
    ['😀', 'emoji simples'],
    ['🇧🇷', 'flag'],
    ['👍🏽', 'tom de pele'],
    ['👨‍👩‍👧‍👦', 'sequência ZWJ'],
    ['1️⃣', 'keycap'],
    ['  😀\n', 'espaços nas extremidades'],
  ])('aceita %s (%s)', (text) => {
    expect(isSingleEmoji(text)).toBe(true);
  });

  it.each([
    ['A', 'texto simples'],
    ['😀 oi', 'emoji acompanhado de texto'],
    ['😀😀', 'dois emojis'],
    ['©', 'símbolo em apresentação de texto'],
    ['🏽', 'modificador isolado'],
  ])('rejeita %s (%s)', (text) => {
    expect(isSingleEmoji(text)).toBe(false);
  });
});
