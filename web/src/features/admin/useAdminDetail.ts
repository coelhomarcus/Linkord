import { useCallback, useEffect, useRef, useState } from 'react';
import { isStaleStateError } from './adminErrors';

export type AdminDetailStatus = 'loading' | 'ready' | 'missing' | 'error';

interface Loaded<T> { id: string; data: T }

function statusOf(err: unknown): 'missing' | 'error' {
  return (err as { status?: number } | null)?.status === 404 ? 'missing' : 'error';
}

/** Loads one admin entity by id.
 *
 * - `data` only ever belongs to the CURRENT `id`: it is tied to the id it was
 *   fetched for and hidden otherwise, so on A → B no render shows A's data
 *   (and its enabled actions) under B.
 * - Every read is tied to a generation; an answer to a superseded read (a slow
 *   A landing after B, or an older refresh) is dropped.
 * - `refresh` re-reads after a mutation WITHOUT touching what is on screen. If
 *   it fails the data stays and `refreshFailed` is set, so the page can say
 *   "the action went through, the view is out of date" instead of making the
 *   admin think the mutation failed (and repeat it). */
export function useAdminDetail<T>(id: string, fetcher: (id: string) => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [failure, setFailure] = useState<{ id: string; status: 'missing' | 'error' } | null>(null);
  // tied to an id like the data, so they can't leak onto another entity
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshFailedId, setRefreshFailedId] = useState<string | null>(null);
  const generation = useRef(0);
  const fetchRef = useRef(fetcher);
  useEffect(() => { fetchRef.current = fetcher; });

  const read = useCallback(() => {
    const mine = ++generation.current;
    fetchRef.current(id)
      .then((data) => { if (mine === generation.current) setLoaded({ id, data }); })
      .catch((err: unknown) => {
        if (mine === generation.current) setFailure({ id, status: statusOf(err) });
      });
  }, [id]);

  useEffect(() => { read(); }, [read]);

  /** Retry after a failed first load. */
  const reload = useCallback(() => {
    setFailure(null);
    setRefreshingId(null);
    setRefreshFailedId(null);
    read();
  }, [read]);

  /** Resolves true when the fresh data landed. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const mine = ++generation.current;
    setRefreshingId(id);
    try {
      const data = await fetchRef.current(id);
      if (mine !== generation.current) return false;
      setLoaded({ id, data });
      setRefreshFailedId(null);
      return true;
    } catch (err) {
      if (mine !== generation.current) return false;
      // the entity vanished under us (deleted by someone else): that is a fact, not a hiccup
      if (statusOf(err) === 'missing') setFailure({ id, status: 'missing' });
      else setRefreshFailedId(id);
      return false;
    } finally {
      if (mine === generation.current) setRefreshingId(null);
    }
  }, [id]);

  /** Runs a mutation, then re-reads. A refusal because the entity changed under
   * the admin (409/404) re-reads too, so the screen catches up with what the
   * error message says — and the error still reaches the caller. */
  const mutate = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (err) {
      if (isStaleStateError(err)) void refresh();
      throw err;
    }
    void refresh();
  }, [refresh]);

  const data = loaded?.id === id ? loaded.data : null;
  const failed = failure?.id === id ? failure.status : null;
  const status: AdminDetailStatus = failed ?? (data ? 'ready' : 'loading');

  return { data, status, refresh, mutate, refreshing: refreshingId === id, refreshFailed: refreshFailedId === id, reload };
}
