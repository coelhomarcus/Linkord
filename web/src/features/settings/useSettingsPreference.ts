/** General app preferences (not per-stream), persisted in localStorage —
 * shown in the sidebar's "Settings" tab. */

const SHOW_STATS_KEY = 'ss-show-stats';

export function loadShowStats(): boolean {
  return localStorage.getItem(SHOW_STATS_KEY) !== '0';
}

export function saveShowStats(value: boolean): void {
  localStorage.setItem(SHOW_STATS_KEY, value ? '1' : '0');
}

// Sound effects volume (mute/unmute, deafen, join/leave call, camera/
// screen, new message) — one slider for all of them, see
// shared/sounds.ts#setVolume. Defaults to 0.65, not 1: full volume was
// too loud.
const NOTIFY_VOLUME_KEY = 'ss-notify-volume';
const DEFAULT_NOTIFY_VOLUME = 0.65;

export function loadNotifyVolume(): number {
  const raw = localStorage.getItem(NOTIFY_VOLUME_KEY);
  if (raw == null) return DEFAULT_NOTIFY_VOLUME;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_NOTIFY_VOLUME;
}

export function saveNotifyVolume(value: number): void {
  localStorage.setItem(NOTIFY_VOLUME_KEY, String(value));
}

// AI-based background noise removal (Krisp, via @livekit/krisp-noise-filter)
// applied on top of the mic track — see useMicrophone.ts#activateMic.
// Defaults to on: it's the biggest audible improvement for most people, and
// costs nothing until a mic is actually activated (the model loads lazily).
const NOISE_SUPPRESSION_KEY = 'ss-noise-suppression';

export function loadNoiseSuppression(): boolean {
  return localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0';
}

export function saveNoiseSuppression(value: boolean): void {
  localStorage.setItem(NOISE_SUPPRESSION_KEY, value ? '1' : '0');
}
