// Per-account sliding-window action limiter for the realtime socket.
// Unlike modules/auth/ratelimit.ts (built around FAILED attempts, blocked
// until they age out), every call here is otherwise-legitimate traffic —
// this just caps how many of a given action one account can fire within a
// window, dropping anything past that. Keyed by userId (not the
// per-connection participant id), so a flood spread across multiple tabs/
// reconnects from the same compromised account still gets capped in
// aggregate. In-memory only, matching the rest of this server's realtime
// state (participants, ratelimit.ts) — doesn't need to survive a restart or
// be shared across instances.

interface Rule {
  windowMs: number;
  max: number;
}

const timestampsByKey = new Map<string, number[]>();

/** true = allowed (and recorded against the window); false = already at the
 * limit for this key/window, caller should drop the action. */
export function allow(key: string, rule: Rule): boolean {
  const now = Date.now();
  const list = timestampsByKey.get(key);
  const kept = list ? list.filter((t) => now - t < rule.windowMs) : [];
  if (kept.length >= rule.max) {
    timestampsByKey.set(key, kept);
    return false;
  }
  kept.push(now);
  timestampsByKey.set(key, kept);
  return true;
}

// Periodic sweep so idle/disconnected accounts don't grow this map forever.
// Every rule in ACTION_LIMITS (see realtime/socket.ts) uses a window well
// under this, so a key whose newest timestamp is already this old is stale
// no matter which rule wrote it.
const STALE_AFTER_MS = 5 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, list] of timestampsByKey) {
    if (!list.length || now - list[list.length - 1]! > STALE_AFTER_MS) timestampsByKey.delete(key);
  }
}, STALE_AFTER_MS);
sweepTimer.unref();
