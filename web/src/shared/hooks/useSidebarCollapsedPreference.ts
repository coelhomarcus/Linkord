
const KEY = 'ss-sidebar-collapsed';

export function loadSidebarCollapsed(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function saveSidebarCollapsed(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}
