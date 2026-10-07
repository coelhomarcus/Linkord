import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useCursorList } from '@/shared/hooks/useCursorList';
import type { ListSnapshot } from '@/shared/hooks/useCursorList';
import { claimScrollRestore, readListWindow, saveListWindow } from './adminListCache';
import { useAdminScroller } from './useAdminMode';
import { RESTORE_LIST } from './useAdminBack';

type Page<T> = { items: T[]; nextCursor: string | null };

/** `useCursorList` for an admin list that remembers where the admin was.
 *
 * Leaving the list keeps its loaded rows and scroll position in memory; coming
 * BACK (browser back, or the detail's own back link) restores both at once and
 * re-reads the same pages in the background. A fresh visit (a sidebar click, a
 * new link) starts clean. Any admin mutation drops the memory first, so a
 * restored window never predates a change the admin made. */
export function useAdminList<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, identity: string, getKey: (item: T) => string) {
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const scroller = useAdminScroller();
  const key = `${pathname}\n${identity}`;
  const coming = navigationType === 'POP' || (state as { restoreList?: boolean } | null)?.restoreList === RESTORE_LIST.restoreList;
  const [seed] = useState(() => (coming ? readListWindow(key) : null));

  const list = useCursorList(fetchPage, identity, { getKey, restore: (seed?.snapshot as ListSnapshot<T> | undefined) ?? null });

  const scrollTop = useRef(seed?.scrollTop ?? 0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => { scrollTop.current = el.scrollTop; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scroller]);

  useLayoutEffect(() => {
    if (!seed) return;
    claimScrollRestore();
    scroller.current?.scrollTo?.({ top: seed.scrollTop });
  }, [seed, scroller]);

  const latest = useRef({ key, list });
  useEffect(() => { latest.current = { key, list }; });
  useEffect(() => () => {
    const { key: lastKey, list: lastList } = latest.current;
    const snapshot = lastList.snapshot();
    if (lastList.status === 'ready' && snapshot.items.length > 0) saveListWindow(lastKey, snapshot, scrollTop.current);
  }, []);

  return list;
}
