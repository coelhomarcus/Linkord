import { useEffect, useState } from 'react';

// Chat attachments are served with `Cache-Control: private, no-cache`
// (server/src/modules/attachments/attachmentServing.ts) — deliberately, so a
// member removed from a conversation loses access to its images instead of
// the browser replaying a stale cached copy for up to a year. The cost is
// that every <img> MOUNT (not just a cold load) pays a real revalidation
// round trip, even for a conversation switched away from seconds ago —
// message rows unmount/remount on every conversation switch, so this is what
// reads as "loading again" instead of Discord's instant repaint.
//
// This cache doesn't touch that server guarantee: it only reuses a blob
// AFTER it has already passed the membership check once in this tab. A
// removed member still can't fetch a NEW image, and still loses access on
// their next reload — this only skips redundant re-fetches of something the
// tab already has in memory, the same thing the browser's own HTTP cache
// already keeps on disk regardless.
interface Entry { objectUrl: string; refCount: number }
const cache = new Map<string, Entry>(); // insertion order doubles as LRU order for refCount === 0 entries
const MAX_IDLE_ENTRIES = 200;

function touch(url: string, entry: Entry) {
  cache.delete(url);
  cache.set(url, entry); // re-insert at the end = most recently used
}

function evictIdleEntries() {
  if (cache.size <= MAX_IDLE_ENTRIES) return;
  for (const [url, entry] of cache) {
    if (cache.size <= MAX_IDLE_ENTRIES) break;
    if (entry.refCount > 0) continue; // never drop something currently on screen
    URL.revokeObjectURL(entry.objectUrl);
    cache.delete(url);
  }
}

/** Test-only: without this, two tests mocking different bytes for the same
 * url leak into each other through the module-level cache. */
export function __resetCachedImageSrcForTests(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.objectUrl);
  cache.clear();
}

/** A `src` for an <img> that repaints instantly on every remount after the
 * first successful load, instead of re-triggering a network round trip —
 * see the module comment above for why chat attachments need this. `null`
 * while the first fetch for a given url is in flight — callers should leave
 * `src` unset rather than falling back to the raw url during that window:
 * that would fire a second, concurrent request for the same resource (a real
 * regression measured live — 20 /uploads/ requests for 8 attachments on a
 * cold load). The raw url is only ever used as a fallback AFTER our own
 * fetch has actually failed, never alongside it. */
export function useCachedImageSrc(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => (url ? cache.get(url)?.objectUrl ?? null : null));

  useEffect(() => {
    if (!url) { setSrc(null); return; }

    const existing = cache.get(url);
    if (existing) {
      existing.refCount++;
      touch(url, existing);
      setSrc(existing.objectUrl);
      return () => { existing.refCount--; evictIdleEntries(); };
    }

    let cancelled = false;
    const controller = new AbortController();
    setSrc(null);
    fetch(url, { credentials: 'same-origin', signal: controller.signal })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        cache.set(url, { objectUrl, refCount: 1 });
        evictIdleEntries();
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setSrc(url); }); // last resort: a normal <img> load, only after ours failed

    return () => {
      cancelled = true;
      controller.abort();
      const entry = cache.get(url);
      if (entry) { entry.refCount--; evictIdleEntries(); }
    };
  }, [url]);

  return src;
}
