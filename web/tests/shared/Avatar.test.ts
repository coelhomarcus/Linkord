import { describe, expect, it } from 'vitest';
import { colorFor, normalizeAvatarColor } from '@/shared/Avatar';

describe('colorFor', () => {
  it('is deterministic — the same id always returns the same color', () => {
    assertSame('participant-123');
    assertSame('some-other-id');
    function assertSame(id: string) {
      expect(colorFor(id)).toBe(colorFor(id));
    }
  });

  it('different ids tend to different colors (does not collapse everything to one)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => colorFor(id)));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('empty/falsy id does not throw — falls back to the first palette color', () => {
    expect(() => colorFor('')).not.toThrow();
    expect(colorFor('')).toBe(colorFor(''));
  });

  it('always returns one of the expected color tokens (never undefined)', () => {
    const color = colorFor('any-id');
    expect(color).toMatch(/^var\(--color-/);
  });

  it('prioritizes the color chosen by the user when it is valid', () => {
    expect(colorFor('any-id', 'green')).toBe('var(--color-green)');
    expect(colorFor('any-id', 'fuchsia')).toBe('var(--color-fuchsia)');
  });

  it('normalizes only the allowed avatar color keys, or a valid hex', () => {
    expect(normalizeAvatarColor('red')).toBe('red');
    expect(normalizeAvatarColor('  blurple  ')).toBe('blurple');
    expect(normalizeAvatarColor('hotpink')).toBe('');
    expect(normalizeAvatarColor('')).toBe('');
    expect(normalizeAvatarColor('#A1B2C3')).toBe('#a1b2c3');
    expect(normalizeAvatarColor('#zzzzzz')).toBe('');
    expect(normalizeAvatarColor('#fff')).toBe('');
  });

  it('custom color (hex outside the presets) becomes the raw CSS value, no token', () => {
    expect(colorFor('any-id', '#a1b2c3')).toBe('#a1b2c3');
  });
});
