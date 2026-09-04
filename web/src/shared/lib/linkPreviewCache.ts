import { fetchLinkPreview, type LinkPreviewData } from './api';

/**
 * In-memory cache (current tab only, gone on reload) of each URL's
 * preview — the same link can appear multiple times in one session
 * (scrolling the chat, again in Settings' Media tab); without this, each
 * appearance would repeat the backend call (which already has its own 6h
 * cache, but there's no reason to pay that network round trip again
 * either). Dedupes concurrent requests via `pending`: two messages with
 * the same link arriving together trigger only ONE call.
 */
const cache = new Map<string, LinkPreviewData>();
const pending = new Map<string, Promise<LinkPreviewData>>();

export function getCachedLinkPreview(url: string): LinkPreviewData | undefined {
  return cache.get(url);
}

export function loadLinkPreview(url: string): Promise<LinkPreviewData> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const promise = fetchLinkPreview(url)
    .then((data) => {
      cache.set(url, data);
      return data;
    })
    .finally(() => {
      pending.delete(url);
    });
  pending.set(url, promise);
  return promise;
}
