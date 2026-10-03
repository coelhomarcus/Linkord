import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMacPlatform, shortcutHint, shortcutModifierLabel } from '@/shared/lib/platform';

function stubNavigator(overrides: { userAgentData?: { platform: string }; platform?: string; userAgent?: string }) {
  vi.stubGlobal('navigator', { ...navigator, ...overrides });
}

describe('isMacPlatform / shortcutModifierLabel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('userAgentData.platform says "macOS": Mac, shows ⌘', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' } });
    expect(isMacPlatform()).toBe(true);
    expect(shortcutModifierLabel()).toBe('⌘');
  });

  it('userAgentData.platform says "Windows": not Mac, shows Ctrl', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' } });
    expect(isMacPlatform()).toBe(false);
    expect(shortcutModifierLabel()).toBe('Ctrl');
  });

  it('userAgentData.platform says "Linux": not Mac, shows Ctrl', () => {
    stubNavigator({ userAgentData: { platform: 'Linux' } });
    expect(isMacPlatform()).toBe(false);
    expect(shortcutModifierLabel()).toBe('Ctrl');
  });

  it('without userAgentData, falls back to navigator.platform ("MacIntel")', () => {
    stubNavigator({ userAgentData: undefined, platform: 'MacIntel', userAgent: 'Mozilla/5.0' });
    expect(isMacPlatform()).toBe(true);
  });

  it('without userAgentData or platform, falls back to userAgent', () => {
    stubNavigator({ userAgentData: undefined, platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' });
    expect(isMacPlatform()).toBe(true);
  });
});

describe('shortcutHint', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('on Mac: no "+", the symbol is already its own visual unit', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' } });
    expect(shortcutHint('K')).toBe('⌘K');
  });

  it('off Mac: with "+", "Ctrl" is a word and reads ambiguous glued together', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' } });
    expect(shortcutHint('K')).toBe('Ctrl+K');
  });
});
