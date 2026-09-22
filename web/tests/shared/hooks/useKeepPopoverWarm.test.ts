import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeepPopoverWarm } from '@/shared/hooks/useKeepPopoverWarm';

describe('useKeepPopoverWarm', () => {
  it('começa frio (false) enquanto nunca foi aberto', () => {
    const { result } = renderHook(() => useKeepPopoverWarm(false));
    expect(result.current).toBe(false);
  });

  it('esquenta (true) assim que abre pela primeira vez', () => {
    const { result, rerender } = renderHook(({ open }) => useKeepPopoverWarm(open), { initialProps: { open: false } });
    expect(result.current).toBe(false);
    rerender({ open: true });
    expect(result.current).toBe(true);
  });

  it('depois de esquentar, continua true mesmo fechando de novo', () => {
    const { result, rerender } = renderHook(({ open }) => useKeepPopoverWarm(open), { initialProps: { open: true } });
    expect(result.current).toBe(true);
    rerender({ open: false });
    expect(result.current).toBe(true);
    rerender({ open: true });
    expect(result.current).toBe(true);
  });
});
