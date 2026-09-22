import { useCallback, useEffect, useRef, useState } from 'react';

interface Page<T> { items: T[]; nextCursor: string | null }

export type ListStatus = 'loading' | 'error' | 'ready';

interface Options<T> {
  /** Changes whenever the SAME query may have new data (a social event, an action
   * of this tab). The rows on screen stay while it is re-read. */
  revision?: string | number;
  /** Stable id of a row: rows are de-duplicated by it, and `removeItem` needs it. */
  getKey?: (item: T) => string;
}

/** A keyset-paginated list.
 *
 * - `identity` is WHAT is being listed (a search text, a filter, a direction).
 *   When it changes the old rows and cursor are dropped at once — buttons of
 *   the previous context must never sit under the new one.
 * - `options.revision` is the same query, invalidated. The list re-reads the
 *   pages it had loaded (not just the first) and swaps them in together; if
 *   any link fails the previous window stays, marked `stale`.
 * - A failed "load more" keeps every row and is reported apart
 *   (`loadMoreError`); only the FIRST load can turn the list into `error`.
 * - Every response is tied to a generation: an answer to a superseded request,
 *   or one that lands after unmount, is dropped. */
export function useCursorList<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, identity: string, options: Options<T> = {}) {
  const { revision = 0 } = options;
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const generation = useRef(0);
  const pagesLoaded = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const fetchRef = useRef(fetchPage);
  const getKeyRef = useRef(options.getKey);
  const seen = useRef<{ identity: string; revision: string | number } | null>(null);
  useEffect(() => { fetchRef.current = fetchPage; getKeyRef.current = options.getKey; });

  const dedupe = useCallback((rows: T[]): T[] => {
    const key = getKeyRef.current;
    if (!key) return rows;
    const ids = new Set<string>();
    return rows.filter((row) => { const id = key(row); if (ids.has(id)) return false; ids.add(id); return true; });
  }, []);

  const loadFirst = useCallback(() => {
    const mine = ++generation.current;
    setStatus('loading');
    setRefreshing(false);
    setStale(false);
    setLoadMoreError(false);
    setLoadingMore(false);
    fetchRef.current(null)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems(dedupe(page.items));
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor;
        pagesLoaded.current = 1;
        setStatus('ready');
      })
      .catch(() => { if (mine === generation.current) setStatus('error'); });
  }, [dedupe]);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    const wanted = Math.max(1, pagesLoaded.current);
    setRefreshing(true);
    setLoadingMore(false);
    void (async () => {
      let cursor: string | null = null;
      let rows: T[] = [];
      let pages = 0;
      try {
        do {
          const page = await fetchRef.current(cursor);
          if (mine !== generation.current) return;
          rows = rows.concat(page.items);
          cursor = page.nextCursor;
          pages++;
        } while (cursor && pages < wanted);
        setItems(dedupe(rows));
        setNextCursor(cursor);
        cursorRef.current = cursor;
        pagesLoaded.current = pages;
        setStale(false);
        setLoadMoreError(false);
      } catch {
        if (mine === generation.current) setStale(true);
      } finally {
        if (mine === generation.current) setRefreshing(false);
      }
    })();
  }, [dedupe]);

  useEffect(() => {
    const previous = seen.current;
    seen.current = { identity, revision };
    if (!previous || previous.identity !== identity) {
      // a different query: nothing from the old one may stay on screen
      setItems([]);
      setNextCursor(null);
      cursorRef.current = null;
      pagesLoaded.current = 0;
      loadFirst();
    } else if (previous.revision !== revision) {
      refresh();
    }
  }, [identity, revision, loadFirst, refresh]);

  // a late answer must never touch a list that is gone
  useEffect(() => () => { generation.current++; }, []);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setLoadMoreError(false);
    fetchRef.current(cursor)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems((prev) => dedupe([...prev, ...page.items]));
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor;
        pagesLoaded.current += 1;
      })
      .catch(() => { if (mine === generation.current) setLoadMoreError(true); })
      .finally(() => { if (mine === generation.current) setLoadingMore(false); });
  }, [loadingMore, dedupe]);

  /** Retries whatever failed: the first load, or a refresh that left the list stale. */
  const retry = useCallback(() => {
    if (status === 'error') loadFirst();
    else refresh();
  }, [status, loadFirst, refresh]);

  /** Drops a row the server just confirmed gone. A read that started before the
   * change is discarded so it can't put the row back. */
  const removeItem = useCallback((key: string) => {
    const keyOf = getKeyRef.current;
    if (!keyOf) return;
    generation.current++;
    setRefreshing(false);
    setItems((prev) => prev.filter((row) => keyOf(row) !== key));
  }, []);

  return { items, status, loadingMore, loadMoreError, hasMore: nextCursor !== null, loadMore, retry, refreshing, stale, removeItem };
}
