interface Bucket {
  timestamps: number[];
  lastSeenAt: number;
}

interface Policy {
  group: string;
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, Bucket>();
const DEFAULT_POLICY: Policy = { group: 'default', limit: 60, windowMs: 10_000 };

function policyFor(eventName: string): Policy {
  if (eventName === 'chat') return { group: 'chat-send', limit: 12, windowMs: 10_000 };
  if (eventName === 'chat-react' || eventName === 'reaction') return { group: 'reactions', limit: 30, windowMs: 10_000 };
  if (eventName === 'speaking' || eventName === 'mic-state' || eventName === 'camera' || eventName === 'screen-share') {
    return { group: 'media-state', limit: 80, windowMs: 10_000 };
  }
  if (eventName === 'ping') return { group: 'ping', limit: 30, windowMs: 10_000 };
  // Realtime transports may reconnect several times while a mobile network
  // changes path; keep enough headroom for that while still bounding sockets
  // that never settle.
  if (eventName === 'join') return { group: 'join', limit: 20, windowMs: 60_000 };
  return DEFAULT_POLICY;
}

/** Consumes one realtime event. The key is account-wide, so opening more
 * tabs cannot multiply the allowance. Returns Retry-After seconds when the
 * policy is exceeded, otherwise null. */
export function consumeWsEvent(userId: string, eventName: string, now = Date.now()): number | null {
  const policy = policyFor(eventName);
  const key = `${userId}:${policy.group}`;
  const current = buckets.get(key);
  const cutoff = now - policy.windowMs;
  const timestamps = current?.timestamps.filter((timestamp) => timestamp > cutoff) ?? [];

  if (timestamps.length >= policy.limit) {
    buckets.set(key, { timestamps, lastSeenAt: now });
    return Math.max(1, Math.ceil((timestamps[0]! + policy.windowMs - now) / 1000));
  }

  timestamps.push(now);
  buckets.set(key, { timestamps, lastSeenAt: now });
  return null;
}

/** Test hook; production cleanup happens in the periodic sweep below. */
export function clearWsRateLimits(): void {
  buckets.clear();
}

const sweepTimer = setInterval(() => {
  const staleBefore = Date.now() - 2 * 60_000;
  for (const [key, bucket] of buckets) {
    if (bucket.lastSeenAt < staleBefore) buckets.delete(key);
  }
}, 60_000);
sweepTimer.unref();
