import { describe, expect, it } from 'vitest';
import { mentionsUsername } from './mentions';

describe('mentionsUsername', () => {
  it('sem username, nunca da match', () => {
    expect(mentionsUsername('@lune oi', null)).toBe(false);
  });

  it('detecta @username exato', () => {
    expect(mentionsUsername('oi @lune tudo bem?', 'lune')).toBe(true);
  });

  it('e case-insensitive', () => {
    expect(mentionsUsername('oi @Lune', 'lune')).toBe(true);
    expect(mentionsUsername('oi @lune', 'Lune')).toBe(true);
  });

  it('nao da match em outro username', () => {
    expect(mentionsUsername('oi @ciclano', 'lune')).toBe(false);
  });

  it('nao da match sem @ nenhum', () => {
    expect(mentionsUsername('lune, tudo bem?', 'lune')).toBe(false);
  });
});
