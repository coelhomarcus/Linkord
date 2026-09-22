import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMacPlatform, shortcutHint, shortcutModifierLabel } from '@/shared/lib/platform';

function stubNavigator(overrides: { userAgentData?: { platform: string }; platform?: string; userAgent?: string }) {
  vi.stubGlobal('navigator', { ...navigator, ...overrides });
}

describe('isMacPlatform / shortcutModifierLabel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('userAgentData.platform diz "macOS": Mac, mostra ⌘', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' } });
    expect(isMacPlatform()).toBe(true);
    expect(shortcutModifierLabel()).toBe('⌘');
  });

  it('userAgentData.platform diz "Windows": nao é Mac, mostra Ctrl', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' } });
    expect(isMacPlatform()).toBe(false);
    expect(shortcutModifierLabel()).toBe('Ctrl');
  });

  it('userAgentData.platform diz "Linux": nao é Mac, mostra Ctrl', () => {
    stubNavigator({ userAgentData: { platform: 'Linux' } });
    expect(isMacPlatform()).toBe(false);
    expect(shortcutModifierLabel()).toBe('Ctrl');
  });

  it('sem userAgentData, cai pro navigator.platform ("MacIntel")', () => {
    stubNavigator({ userAgentData: undefined, platform: 'MacIntel', userAgent: 'Mozilla/5.0' });
    expect(isMacPlatform()).toBe(true);
  });

  it('sem userAgentData nem platform, cai pro userAgent', () => {
    stubNavigator({ userAgentData: undefined, platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' });
    expect(isMacPlatform()).toBe(true);
  });
});

describe('shortcutHint', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('no Mac: sem "+", o símbolo já é uma unidade visual própria', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' } });
    expect(shortcutHint('K')).toBe('⌘K');
  });

  it('fora do Mac: com "+", "Ctrl" é uma palavra e fica ambíguo colado', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' } });
    expect(shortcutHint('K')).toBe('Ctrl+K');
  });
});
