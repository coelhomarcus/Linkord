import { fetchLinkPreview, type LinkPreviewData } from './api';

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
