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

  it('tres ou mais pessoas', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano'])).toBe('Fulano e mais 2 estão digitando...');
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano', 'Deltrana'])).toBe('Fulano e mais 3 estão digitando...');
  });
});
