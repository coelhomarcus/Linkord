import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoFocusScreenShare } from '@/features/calls/useAutoFocusScreenShare';
import type { TileDescriptor } from '@/features/calls/tileTypes';

const tile = (key: string, kind: TileDescriptor['kind']): TileDescriptor => ({
  key, participantId: key.split(':')[0]!, kind, loading: false, paused: false,
});

describe('useAutoFocusScreenShare', () => {
  it('does not focus anything on the first render, even if a screen share already exists', () => {
    const onAutoFocus = vi.fn();
    renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [tile('p1:screen', 'screen')], origin: null as 'manual' | 'automatic' | null },
    });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });

  it('focuses when a new screen appears after the first render', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: null });
    expect(onAutoFocus).toHaveBeenCalledWith('p1:screen');
  });

  it('never replaces an active manual focus', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: 'manual' as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: 'manual' });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });

  it('a second new screen can still suggest automatic focus if the origin is not manual', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: 'automatic' });
    expect(onAutoFocus).toHaveBeenCalledWith('p1:screen');
    onAutoFocus.mockClear();

    rerender({ descriptors: [tile('p1:screen', 'screen'), tile('p2:screen', 'screen')], origin: 'automatic' });
    expect(onAutoFocus).toHaveBeenCalledWith('p2:screen');
  });

  it('camera/avatar tiles do not trigger automatic focus', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:participant', 'camera')], origin: null });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });

  it('a new screen STILL overrides a focus with origin "capacity" (only "manual" blocks it)', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | 'capacity' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: 'capacity' });
    expect(onAutoFocus).toHaveBeenCalledWith('p1:screen');
  });

  it('a screen that disappears and reappears with the same key does not trigger again (still "seen")', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: null });
    onAutoFocus.mockClear();
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: null });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });
});
