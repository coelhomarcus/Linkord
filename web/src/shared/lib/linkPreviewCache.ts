import { fetchLinkPreview, type LinkPreviewData } from '@/shared/api/api';

// Bounded: a long session scrolling through link-heavy chats used to keep
// every preview it ever fetched. Insertion order doubles as LRU order.
const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { data: LinkPreviewData; at: number }>();
const pending = new Map<string, Promise<LinkPreviewData>>();

export function getCachedLinkPreview(url: string): LinkPreviewData | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) { cache.delete(url); return undefined; }
  cache.delete(url);
  cache.set(url, entry);
  return entry.data;
}

export function loadLinkPreview(url: string): Promise<LinkPreviewData> {
  const cached = getCachedLinkPreview(url);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const promise = fetchLinkPreview(url)
    .then((data) => {
      cache.set(url, { data, at: Date.now() });
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return data;
    })
    .finally(() => {
      pending.delete(url);
    });
  pending.set(url, promise);
  return promise;
}

/** Test-only: the module-level cache would leak between tests. */
export function __resetLinkPreviewCacheForTests(): void {
  cache.clear();
  pending.clear();
}
