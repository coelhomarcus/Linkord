import { beforeEach, describe, expect, it } from 'vitest';
import { loadQuality, saveQuality } from './useQualityPreference';

beforeEach(() => {
  localStorage.clear();
});

describe('loadQuality / saveQuality', () => {
  it('sem valor salvo, default e "standard"', () => {
    expect(loadQuality()).toBe('standard');
  });

  it('save/load faz round-trip pras 3 opcoes', () => {
    saveQuality('reduced');
    expect(loadQuality()).toBe('reduced');
    saveQuality('minimum');
    expect(loadQuality()).toBe('minimum');
    saveQuality('standard');
    expect(loadQuality()).toBe('standard');
  });

  it('valor desconhecido no localStorage cai no default "standard"', () => {
    localStorage.setItem('ss-quality', 'ultra-hd-nao-existe');
    expect(loadQuality()).toBe('standard');
  });
});
