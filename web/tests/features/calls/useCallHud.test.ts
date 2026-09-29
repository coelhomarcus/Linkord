import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCallHud } from '@/features/calls/useCallHud';

describe('useCallHud', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts visible', () => {
    const { result } = renderHook(() => useCallHud(false));
    expect(result.current.hudVisible).toBe(true);
  });

  it('hides itself after idle time (2500ms), with no activity', () => {
    const { result } = renderHook(() => useCallHud(false));
    expect(result.current.hudVisible).toBe(true);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.hudVisible).toBe(false);
  });

  it('moving the mouse before time runs out resets the countdown — does not hide', () => {
    const { result } = renderHook(() => useCallHud(false));

    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new Event('mousemove')); });
    act(() => { vi.advanceTimersByTime(2000); });
    // 4000ms passed in total, but the last activity was only 2000ms ago
    expect(result.current.hudVisible).toBe(true);
  });

  it('key press or touch also count as activity, not just the mouse', () => {
    const { result } = renderHook(() => useCallHud(false));
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.hudVisible).toBe(true);

    act(() => { window.dispatchEvent(new Event('touchstart')); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.hudVisible).toBe(true);
  });

  it('suspend=true always keeps it visible, even after a long idle time', () => {
    const { result } = renderHook(() => useCallHud(true));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.hudVisible).toBe(true);
  });

  it('suspend switching from false to true forces it to reveal again (e.g. a menu opened)', () => {
    const { result, rerender } = renderHook(({ suspend }) => useCallHud(suspend), { initialProps: { suspend: false } });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.hudVisible).toBe(false);

    rerender({ suspend: true });
    expect(result.current.hudVisible).toBe(true);

    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.hudVisible).toBe(true);
  });

  it('revealHud() forces it visible and immediately resets the countdown', () => {
    const { result } = renderHook(() => useCallHud(false));
    act(() => { vi.advanceTimersByTime(2400); });
    act(() => { result.current.revealHud(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.hudVisible).toBe(true);
  });
});
