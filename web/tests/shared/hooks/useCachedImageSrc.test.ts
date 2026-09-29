import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { __cachedImageCountForTests, __resetCachedImageSrcForTests, useCachedImageSrc } from '@/shared/hooks/useCachedImageSrc';

describe('useCachedImageSrc — memory budget', () => {
  afterEach(() => { __resetCachedImageSrcForTests(); vi.unstubAllGlobals(); });

  it('large off-screen images get evicted by size; visible ones never do', async () => {
    // 20 MB each: four idle ones exceed the 64 MB budget
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(20 * 1024 * 1024)]) })));
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${n++}`), revokeObjectURL: vi.fn() }));

    const visible = renderHook(() => useCachedImageSrc('/uploads/visible'));
    await waitFor(() => expect(visible.result.current).not.toBeNull());
    for (let i = 0; i < 5; i++) {
      const hook = renderHook(() => useCachedImageSrc(`/uploads/photo${i}`));
      await waitFor(() => expect(hook.result.current).not.toBeNull());
      hook.unmount();
    }
    // the on-screen one plus at most three idle 20 MB pictures
    expect(__cachedImageCountForTests()).toBeLessThanOrEqual(4);
    const again = renderHook(() => useCachedImageSrc('/uploads/visible'));
    expect(again.result.current).toBe(visible.result.current);
  });
});
