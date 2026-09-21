import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocialEntry, SocialPage } from '@/shared/api/api';

export type ListStatus = 'loading' | 'error' | 'ready';

/** First page + "load more" for a keyset-paginated social list. Refetches the
 * first page whenever `resetKey` changes (a search term, or the social
 * revision) while keeping the rows already on screen, so a live update
 * doesn't flash an empty list. Responses from a superseded request are
 * dropped — a slow page must never overwrite a newer one. */
export function useCursorList(fetchPage: (cursor: string | null) => Promise<SocialPage>, resetKey: string) {
  const [items, setItems] = useState<SocialEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  useEffect(() => { fetchRef.current = fetchPage; }, [fetchPage]);

  const load = useCallback(() => {
    const mine = ++generation.current;
    fetchRef.current(null)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setStatus('ready');
      })
      .catch(() => { if (mine === generation.current) setStatus('error'); });
  }, []);

  useEffect(() => { load(); }, [load, resetKey]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    fetchRef.current(nextCursor)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems((prev) => [...prev, ...page.items]);
        setNextCursor(page.nextCursor);
      })
      .catch(() => { if (mine === generation.current) setStatus('error'); })
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore]);

  const retry = useCallback(() => {
    setStatus('loading');
    load();
  }, [load]);

  return { items, status, loadingMore, hasMore: nextCursor !== null, loadMore, retry };
}
