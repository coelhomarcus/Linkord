import { beforeEach, describe, expect, it } from 'vitest';
import { loadDevicePreference, saveDevicePreference } from './useDevicePreference';

beforeEach(() => {
  localStorage.clear();
});

describe('loadDevicePreference / saveDevicePreference', () => {
  it('sem valor salvo, devolve null', () => {
    expect(loadDevicePreference('audioinput')).toBeNull();
  });

  it('save/load faz round-trip', () => {
    saveDevicePreference('audioinput', 'mic-123');
    expect(loadDevicePreference('audioinput')).toBe('mic-123');
  });

  it('cada kind tem sua propria chave, sem colisao', () => {
    saveDevicePreference('audioinput', 'mic-1');
    saveDevicePreference('videoinput', 'cam-1');
    saveDevicePreference('audiooutput', 'speaker-1');
    expect(loadDevicePreference('audioinput')).toBe('mic-1');
    expect(loadDevicePreference('videoinput')).toBe('cam-1');
    expect(loadDevicePreference('audiooutput')).toBe('speaker-1');
  });
});
