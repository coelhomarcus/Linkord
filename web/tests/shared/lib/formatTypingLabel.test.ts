import { describe, expect, it } from 'vitest';
import { formatTypingLabel } from '@/shared/lib/formatTypingLabel';

describe('formatTypingLabel', () => {
  it('ninguem digitando retorna null', () => {
    expect(formatTypingLabel([])).toBe(null);
  });

  it('uma pessoa', () => {
    expect(formatTypingLabel(['Fulano'])).toBe('Fulano está digitando...');
  });

  it('duas pessoas', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana'])).toBe('Fulano e Beltrana estão digitando...');
  });

  it('tres pessoas: nomeia todo mundo', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano'])).toBe('Fulano, Beltrana e Ciclano estão digitando...');
  });

  it('mais de tres pessoas: cai pro texto genérico, sem listar nomes', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano', 'Deltrana'])).toBe('Várias pessoas estão digitando...');
    expect(formatTypingLabel(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('Várias pessoas estão digitando...');
  });
});
