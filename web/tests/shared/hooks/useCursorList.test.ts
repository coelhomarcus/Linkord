import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCursorList } from '@/shared/hooks/useCursorList';

type Row = { id: string };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const key = (row: Row) => row.id;

/** A fetcher whose responses are settled by hand, in any order. */
function controlled() {
  const calls: { cursor: string | null; resolve: (page: { items: Row[]; nextCursor: string | null }) => void; reject: (err: Error) => void }[] = [];
  const fetchPage = (cursor: string | null) => new Promise<{ items: Row[]; nextCursor: string | null }>((resolve, reject) => { calls.push({ cursor, resolve, reject }); });
  return { calls, fetchPage };
}

describe('useCursorList', () => {
  it('loads the first page and paginates by cursor', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
    expect(result.current.status).toBe('loading');
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
    expect(result.current.items).toEqual(rows('a', 'b'));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    expect(calls[1]!.cursor).toBe('c1');
    await act(async () => calls[1]!.resolve({ items: rows('c'), nextCursor: null }));
    expect(result.current.items).toEqual(rows('a', 'b', 'c'));
    expect(result.current.hasMore).toBe(false);
  });

  it('changing the identity clears the old rows immediately (nothing from the previous context leaks into the new one)', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ q }) => useCursorList(fetchPage, q, { getKey: key }), { initialProps: { q: 'ana' } });
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: null }));
    expect(result.current.items).toHaveLength(1);
    rerender({ q: 'bea' });
    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.items).toEqual([]);
  });

  it('a response for a superseded query does not overwrite the new one (out of order)', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ q }) => useCursorList(fetchPage, q, { getKey: key }), { initialProps: { q: 'ana' } });
    rerender({ q: 'bea' });
    await waitFor(() => expect(calls.length).toBe(2));
    await act(async () => calls[1]!.resolve({ items: rows('bea'), nextCursor: null })); // the NEW one lands first
    await act(async () => calls[0]!.resolve({ items: rows('ana'), nextCursor: null })); // the old one, late
    expect(result.current.items).toEqual(rows('bea'));
  });

  it('a revision redoes ALL pages already loaded, keeping the rows while reading', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ rev }) => useCursorList(fetchPage, 'q', { revision: rev, getKey: key }), { initialProps: { rev: 0 } });
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
    act(() => result.current.loadMore());
    await act(async () => calls[1]!.resolve({ items: rows('c', 'd'), nextCursor: 'c2' }));
    expect(result.current.items).toHaveLength(4);

    rerender({ rev: 1 });
    await waitFor(() => expect(calls.length).toBe(3));
    expect(result.current.items).toHaveLength(4); // still on screen
    expect(result.current.refreshing).toBe(true);
    await act(async () => calls[2]!.resolve({ items: rows('a', 'x'), nextCursor: 'c1b' }));
    await waitFor(() => expect(calls.length).toBe(4));
    expect(calls[3]!.cursor).toBe('c1b'); // it walked the chain again up to the same depth
    await act(async () => calls[3]!.resolve({ items: rows('y'), nextCursor: null }));
    expect(result.current.items).toEqual(rows('a', 'x', 'y'));
    expect(result.current.refreshing).toBe(false);
    expect(result.current.stale).toBe(false);
  });

  it('a refresh failure keeps the previous window, marked as stale, and allows retrying', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ rev }) => useCursorList(fetchPage, 'q', { revision: rev, getKey: key }), { initialProps: { rev: 0 } });
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: null }));
    rerender({ rev: 1 });
    await waitFor(() => expect(calls.length).toBe(2));
    await act(async () => calls[1]!.reject(new Error('rede')));
    expect(result.current.items).toEqual(rows('a'));
    expect(result.current.status).toBe('ready');
    expect(result.current.stale).toBe(true);
    act(() => result.current.retry());
    await waitFor(() => expect(calls.length).toBe(3));
    await act(async () => calls[2]!.resolve({ items: rows('a', 'z'), nextCursor: null }));
    expect(result.current.stale).toBe(false);
    expect(result.current.items).toEqual(rows('a', 'z'));
  });

  it('an error on "load more" does not wipe the list: it stays separate and can be retried', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: 'c1' }));
    act(() => result.current.loadMore());
    await act(async () => calls[1]!.reject(new Error('rede')));
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toEqual(rows('a'));
    expect(result.current.loadMoreError).toBe(true);
    act(() => result.current.loadMore());
    await act(async () => calls[2]!.resolve({ items: rows('b'), nextCursor: null }));
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.items).toEqual(rows('a', 'b'));
  });

  it('a failure on the FIRST load becomes an error and retry reloads', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q'));
    await act(async () => calls[0]!.reject(new Error('rede')));
    expect(result.current.status).toBe('error');
    act(() => result.current.retry());
    await act(async () => calls[1]!.resolve({ items: rows('a'), nextCursor: null }));
    expect(result.current.status).toBe('ready');
  });

  it('dedupes by id (a row that appears on two pages)', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
    act(() => result.current.loadMore());
    await act(async () => calls[1]!.resolve({ items: rows('b', 'c'), nextCursor: null }));
    expect(result.current.items).toEqual(rows('a', 'b', 'c'));
  });

  it('removeItem drops the row and discards a stale read that would bring it back', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ rev }) => useCursorList(fetchPage, 'q', { revision: rev, getKey: key }), { initialProps: { rev: 0 } });
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: null }));
    rerender({ rev: 1 }); // a refresh starts...
    await waitFor(() => expect(calls.length).toBe(2));
    act(() => result.current.removeItem('a')); // ...an action confirms 'a' is gone
    await act(async () => calls[1]!.resolve({ items: rows('a', 'b'), nextCursor: null })); // the old read still lists it
    expect(result.current.items).toEqual(rows('b'));
  });

  it('a response that arrives after unmount is ignored', async () => {
    const { calls, fetchPage } = controlled();
    const { unmount } = renderHook(() => useCursorList(fetchPage, 'q'));
    unmount();
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: null }));
    // nothing to assert beyond "no state update on an unmounted hook, no throw"
    expect(calls).toHaveLength(1);
  });

  describe('restore', () => {
    const snapshot = { items: rows('a', 'b', 'c'), nextCursor: 'c2', pages: 2 };

    it('shows the restored rows at once and re-reads the same number of pages in place', async () => {
      const { calls, fetchPage } = controlled();
      const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key, restore: snapshot }));
      expect(result.current.status).toBe('ready');
      expect(result.current.items).toEqual(rows('a', 'b', 'c'));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.cursor).toBeNull();
      expect(result.current.refreshing).toBe(true);

      await act(async () => calls[0]!.resolve({ items: rows('a', 'x'), nextCursor: 'n1' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]!.cursor).toBe('n1');
      await act(async () => calls[1]!.resolve({ items: rows('y'), nextCursor: 'n2' }));
      expect(result.current.items).toEqual(rows('a', 'x', 'y'));
      expect(result.current.refreshing).toBe(false);
      expect(result.current.hasMore).toBe(true);
    });

    it('a failed re-read keeps the restored rows and marks them stale', async () => {
      const { calls, fetchPage } = controlled();
      const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key, restore: snapshot }));
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => calls[0]!.reject(new Error('offline')));
      expect(result.current.items).toEqual(rows('a', 'b', 'c'));
      expect(result.current.stale).toBe(true);
      expect(result.current.status).toBe('ready');
    });

    it('a different identity afterwards still starts from scratch', async () => {
      const { calls, fetchPage } = controlled();
      const { result, rerender } = renderHook(({ q }) => useCursorList(fetchPage, q, { getKey: key, restore: snapshot }), { initialProps: { q: 'q' } });
      await waitFor(() => expect(calls).toHaveLength(1));
      rerender({ q: 'other' });
      await waitFor(() => expect(result.current.status).toBe('loading'));
      expect(result.current.items).toEqual([]);
    });

    it('snapshot returns the window as it is now, ready to be restored', async () => {
      const { calls, fetchPage } = controlled();
      const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
      await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
      act(() => result.current.loadMore());
      await act(async () => calls[1]!.resolve({ items: rows('c'), nextCursor: 'c2' }));
      expect(result.current.snapshot()).toEqual({ items: rows('a', 'b', 'c'), nextCursor: 'c2', pages: 2 });
    });
  });
});
