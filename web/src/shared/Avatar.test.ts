import { describe, expect, it } from 'vitest';
import { colorFor } from './Avatar';

describe('colorFor', () => {
  it('e deterministico — o mesmo id sempre devolve a mesma cor', () => {
    assertSame('participante-123');
    assertSame('outro-id-qualquer');
    function assertSame(id: string) {
      expect(colorFor(id)).toBe(colorFor(id));
    }
  });

  it('ids diferentes tendem a cores diferentes (nao trava tudo na mesma)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(colorFor));
    expect(colors.size).toBeGreaterThan(1);
  });

  // id null/vazio acontece de verdade quando a conta de quem mandou a
  // mensagem foi apagada (authorId vira NULL) — sem essa guarda, derrubava
  // o React inteiro (nao so aquele avatar), ver comentario em Avatar.tsx.
  it('id vazio/falsy nao lanca — cai na primeira cor da paleta', () => {
    expect(() => colorFor('')).not.toThrow();
    expect(colorFor('')).toBe(colorFor(''));
  });

  it('devolve sempre um dos tokens de cor esperados (nunca undefined)', () => {
    const color = colorFor('qualquer-id');
    expect(color).toMatch(/^var\(--color-/);
  });
});
