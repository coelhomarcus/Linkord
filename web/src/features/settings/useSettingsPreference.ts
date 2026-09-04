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
