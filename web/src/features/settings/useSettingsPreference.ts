
const SHOW_STATS_KEY = 'ss-show-stats';

export function loadShowStats(): boolean {
  return localStorage.getItem(SHOW_STATS_KEY) !== '0';
}

export function saveShowStats(value: boolean): void {
  localStorage.setItem(SHOW_STATS_KEY, value ? '1' : '0');
}

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
