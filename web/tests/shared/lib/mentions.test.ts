import { describe, expect, it } from 'vitest';
import { mentionsUsername } from '@/shared/lib/mentions';

describe('mentionsUsername', () => {
  it('never matches without a username', () => {
    expect(mentionsUsername('@lune hi', null)).toBe(false);
  });

  it('detects an exact @username', () => {
    expect(mentionsUsername('hi @lune how are you?', 'lune')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(mentionsUsername('hi @Lune', 'lune')).toBe(true);
    expect(mentionsUsername('hi @lune', 'Lune')).toBe(true);
  });

  it('does not match a different username', () => {
    expect(mentionsUsername('hi @someoneelse', 'lune')).toBe(false);
  });

  it('does not match without any @', () => {
    expect(mentionsUsername('lune, how are you?', 'lune')).toBe(false);
  });
});
