import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';

describe('useKeepPopoverWarm', () => {
  it('starts cold (false) while it has never been opened', () => {
    const { result } = renderHook(() => useKeepPopoverWarm(false));
    expect(result.current).toBe(false);
  });

  it('warms up (true) as soon as it opens for the first time', () => {
    const { result, rerender } = renderHook(({ open }) => useKeepPopoverWarm(open), { initialProps: { open: false } });
    expect(result.current).toBe(false);
    rerender({ open: true });
    expect(result.current).toBe(true);
  });

  it('once warmed up, stays true even after closing again', () => {
    const { result, rerender } = renderHook(({ open }) => useKeepPopoverWarm(open), { initialProps: { open: true } });
    expect(result.current).toBe(true);
    rerender({ open: false });
    expect(result.current).toBe(true);
    rerender({ open: true });
    expect(result.current).toBe(true);
  });
});
