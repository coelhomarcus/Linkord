import { beforeEach, describe, expect, it } from 'vitest';
import { loadCallVolume, saveCallVolume } from '@/features/settings/useCallVolumePreference';

beforeEach(() => {
  localStorage.clear();
});

describe('loadCallVolume / saveCallVolume', () => {
  it('with nothing saved, the default is 1 (100%)', () => {
    expect(loadCallVolume('user-1')).toBe(1);
  });

  it('save/load round-trips for a specific key', () => {
    saveCallVolume('user-1', 0.2);
    expect(loadCallVolume('user-1')).toBe(0.2);
  });

  it('different keys (mic vs. screen for one person) do not overwrite each other', () => {
    saveCallVolume('user-1', 0.2);
    saveCallVolume('user-1:screen', 0.8);
    expect(loadCallVolume('user-1')).toBe(0.2);
    expect(loadCallVolume('user-1:screen')).toBe(0.8);
  });

  it('corrupted JSON in localStorage does not throw — falls back to the default', () => {
    localStorage.setItem('ss-call-volumes', '{ this is not valid json');
    expect(loadCallVolume('user-1')).toBe(1);
  });

  it('clamps between 0 and 1', () => {
    saveCallVolume('user-1', 5);
    expect(loadCallVolume('user-1')).toBe(1);
  });
});
