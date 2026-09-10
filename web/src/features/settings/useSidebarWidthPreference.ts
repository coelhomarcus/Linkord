
const KEY = 'ss-sidebar-width';

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_DEFAULT_WIDTH = 272;

function clamp(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

export function loadSidebarWidth(): number {
  const raw = Number(localStorage.getItem(KEY));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : SIDEBAR_DEFAULT_WIDTH;
}

export function saveSidebarWidth(px: number): void {
  localStorage.setItem(KEY, String(clamp(px)));
}
