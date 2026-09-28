// Which rows just arrived and may play their entrance — decided by where the
// message came from (a local send, a live delivery), never by a row simply
// mounting: scrolling back, a page of history, a reconnect or a remount must
// not replay it. Each surface animates a given arrival at most once.

const FRESH_MS = 3000;
const MAX_TRACKED = 200;
// a burst (a paste of messages, a reconnect flush) enters without a cascade
const BURST_WINDOW_MS = 400;
const BURST_MAX = 4;

const arrivedAt = new Map<string, number>();
const consumed = new Map<string, Set<string>>();
const recentAnimations = new Map<string, number[]>();

function trim<K, V>(map: Map<K, V>) {
  while (map.size > MAX_TRACKED) map.delete(map.keys().next().value!);
}

/** `key` is the timeline row key (see messageTimelineItems.ts). */
export function markArrival(key: string, now = Date.now()): void {
  arrivedAt.delete(key);
  arrivedAt.set(key, now);
  trim(arrivedAt);
}

/** True once per surface for a fresh arrival; false for everything else. */
export function takeArrival(surfaceId: string, key: string, now = Date.now()): boolean {
  const at = arrivedAt.get(key);
  if (at === undefined || now - at > FRESH_MS) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  let seen = consumed.get(surfaceId);
  if (!seen) { seen = new Set(); consumed.set(surfaceId, seen); }
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > MAX_TRACKED) seen.delete(seen.values().next().value!);
  const recent = (recentAnimations.get(surfaceId) ?? []).filter((t) => now - t < BURST_WINDOW_MS);
  if (recent.length >= BURST_MAX) { recentAnimations.set(surfaceId, recent); return false; }
  recent.push(now);
  recentAnimations.set(surfaceId, recent);
  return true;
}

/** Test-only. */
export function __resetArrivalsForTests(): void {
  arrivedAt.clear();
  consumed.clear();
  recentAnimations.clear();
}
