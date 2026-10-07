import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAdminDetail } from '@/features/admin/useAdminDetail';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useAdminDetail', () => {
  it('a slow answer for A landing after B never replaces B, and A is never shown under B', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const fetcher = vi.fn((id: string) => (id === 'a' ? a.promise : b.promise));
    const { result, rerender } = renderHook(({ id }) => useAdminDetail(id, fetcher), { initialProps: { id: 'a' } });

    rerender({ id: 'b' });
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe('loading');

    await act(async () => { b.resolve('data-b'); });
    expect(result.current.data).toBe('data-b');
    await act(async () => { a.resolve('data-a'); });
    expect(result.current.data).toBe('data-b');
  });

  it('data of the previous id is hidden on the very render the id changes', async () => {
    const fetcher = vi.fn((id: string) => Promise.resolve(`data-${id}`));
    const { result, rerender } = renderHook(({ id }) => useAdminDetail(id, fetcher), { initialProps: { id: 'a' } });
    await waitFor(() => expect(result.current.data).toBe('data-a'));

    const seen: (string | null)[] = [];
    rerender({ id: 'b' });
    seen.push(result.current.data);
    expect(seen).toEqual([null]);
    await waitFor(() => expect(result.current.data).toBe('data-b'));
  });

  it('a failed refresh keeps what is on screen and reports it apart from a failed load', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('v2');
    const { result } = renderHook(() => useAdminDetail('a', fetcher));
    await waitFor(() => expect(result.current.data).toBe('v1'));

    let ok = true;
    await act(async () => { ok = await result.current.refresh(); });
    expect(ok).toBe(false);
    expect(result.current.data).toBe('v1');
    expect(result.current.status).toBe('ready');
    expect(result.current.refreshFailed).toBe(true);

    await act(async () => { ok = await result.current.refresh(); });
    expect(ok).toBe(true);
    expect(result.current.data).toBe('v2');
    expect(result.current.refreshFailed).toBe(false);
  });

  it('an entity that vanished during a refresh becomes "missing"', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }));
    const { result } = renderHook(() => useAdminDetail('a', fetcher));
    await waitFor(() => expect(result.current.data).toBe('v1'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toBe('missing');
    expect(result.current.refreshFailed).toBe(false);
  });

  it('an older refresh superseded by a newer one is dropped', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce('v0').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAdminDetail('a', fetcher));
    await waitFor(() => expect(result.current.data).toBe('v0'));

    let r1!: Promise<boolean>;
    let r2!: Promise<boolean>;
    act(() => { r1 = result.current.refresh(); r2 = result.current.refresh(); });
    await act(async () => { second.resolve('newer'); await r2; });
    await act(async () => { first.resolve('older'); await r1; });
    expect(result.current.data).toBe('newer');
  });

  it('a load error is "error" and reload retries it', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useAdminDetail('a', fetcher));
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('ok'));
  });
});
