import type { ListSnapshot } from '@/shared/hooks/useCursorList';

// In-memory only, on purpose: rows and scroll positions are never persisted
// (nothing from an admin list may outlive the tab), and everything here is
// dropped on any admin mutation and when the area is left (see `adminFetch`
// and `AdminLayout`). Restoring is a convenience for "back from a detail",
// never a source of truth: the restored window is re-read right away.

interface Entry { snapshot: ListSnapshot<unknown>; scrollTop: number }

const MAX_ENTRIES = 8;
const entries = new Map<string, Entry>();

export function saveListWindow(key: string, snapshot: ListSnapshot<unknown>, scrollTop: number): void {
  entries.delete(key);
  entries.set(key, { snapshot, scrollTop });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

export function readListWindow(key: string): Entry | null {
  return entries.get(key) ?? null;
}

export function invalidateAdminLists(): void {
  entries.clear();
}

// A list restoring its scroll position tells the layout not to scroll to the
// top for that same navigation (the layout's effect runs after the page's).
let scrollClaimed = false;

export function claimScrollRestore(): void {
  scrollClaimed = true;
}

export function consumeScrollRestore(): boolean {
  const claimed = scrollClaimed;
  scrollClaimed = false;
  return claimed;
}
