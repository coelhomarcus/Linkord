import { useSyncExternalStore } from 'react';

// One volume lives outside any single player: every video/audio element in
// the app reads and writes the same value, so turning one down turns them
// all down (matching how a single "system volume" behaves) instead of each
// clip guessing independently and starting at the browser's deafening 100%.
const STORAGE_KEY = 'ss-media-volume';
const DEFAULT_VOLUME = 0.5;

export interface MediaVolumeState {
  volume: number;
  muted: boolean;
}

function loadInitialState(): MediaVolumeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.volume === 'number' && typeof parsed?.muted === 'boolean') {
        return { volume: Math.min(1, Math.max(0, parsed.volume)), muted: parsed.muted };
      }
    }
  } catch {
    // ignore malformed/unavailable storage — fall through to the default
  }
  return { volume: DEFAULT_VOLUME, muted: false };
}

let state: MediaVolumeState = loadInitialState();
const listeners = new Set<() => void>();

export function getMediaVolumeState(): MediaVolumeState {
  return state;
}

export function setMediaVolumeState(volume: number, muted: boolean): void {
  state = { volume: Math.min(1, Math.max(0, volume)), muted };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence only
  }
  for (const listener of listeners) listener();
}

export function subscribeMediaVolume(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders whenever the shared volume changes, from any player. */
export function useMediaVolumeState(): MediaVolumeState {
  return useSyncExternalStore(subscribeMediaVolume, getMediaVolumeState, getMediaVolumeState);
}
