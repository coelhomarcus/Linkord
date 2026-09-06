import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume,
  loadNoiseSuppression, saveNoiseSuppression,
} from './useSettingsPreference';

beforeEach(() => {
  localStorage.clear();
});

describe('loadShowStats / saveShowStats', () => {
  it('sem valor salvo, default e true (so "0" explicito desliga)', () => {
    expect(loadShowStats()).toBe(true);
  });

  it('save(false) depois load() devolve false', () => {
    saveShowStats(false);
    expect(loadShowStats()).toBe(false);
  });

  it('save(true) depois load() devolve true', () => {
    saveShowStats(false);
    saveShowStats(true);
    expect(loadShowStats()).toBe(true);
  });
});

describe('loadNotifyVolume / saveNotifyVolume', () => {
  it('sem valor salvo, default e 0.65', () => {
    expect(loadNotifyVolume()).toBe(0.65);
  });

  it('save/load faz round-trip', () => {
    saveNotifyVolume(0.3);
    expect(loadNotifyVolume()).toBe(0.3);
  });

  it('valor corrompido no localStorage cai no default', () => {
    localStorage.setItem('ss-notify-volume', 'nao-e-numero');
    expect(loadNotifyVolume()).toBe(0.65);
  });

  it('clampa entre 0 e 1 mesmo se algo escrever um valor fora do range', () => {
    localStorage.setItem('ss-notify-volume', '5');
    expect(loadNotifyVolume()).toBe(1);
    localStorage.setItem('ss-notify-volume', '-2');
    expect(loadNotifyVolume()).toBe(0);
  });
});

describe('loadNoiseSuppression / saveNoiseSuppression', () => {
  it('sem valor salvo, default e true (so "0" explicito desliga)', () => {
    expect(loadNoiseSuppression()).toBe(true);
  });

  it('save(false) depois load() devolve false', () => {
    saveNoiseSuppression(false);
    expect(loadNoiseSuppression()).toBe(false);
  });

  it('save(true) depois load() devolve true', () => {
    saveNoiseSuppression(false);
    saveNoiseSuppression(true);
    expect(loadNoiseSuppression()).toBe(true);
  });
});
