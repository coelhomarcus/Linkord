// In-memory attempt limiter (sliding window) — used for login, to make
// password brute-forcing harder. Doesn't need to survive a restart or be
// shared across instances, like the rest of the server's state (participants).

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const failuresByKey = new Map<string, number[]>(); // key -> timestamps[] (so falhas, dentro da janela)

function prune(key: string): number[] {
  const now = Date.now();
  const list = failuresByKey.get(key);
  if (!list) return [];
  const kept = list.filter((t) => now - t < WINDOW_MS);
  if (kept.length === 0) failuresByKey.delete(key);
  else failuresByKey.set(key, kept);
  return kept;
}

/** null if allowed, otherwise the number of seconds until the next try. */
export function checkBlocked(key: string): number | null {
  const kept = prune(key);
  if (kept.length < MAX_FAILURES) return null;
  const oldest = Math.min(...kept);
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000));
}

export function recordFailure(key: string): void {
  const kept = prune(key);
  kept.push(Date.now());
  failuresByKey.set(key, kept);
}

export function reset(key: string): void {
  failuresByKey.delete(key);
}

const sweepTimer = setInterval(() => {
  for (const key of failuresByKey.keys()) prune(key);
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();
