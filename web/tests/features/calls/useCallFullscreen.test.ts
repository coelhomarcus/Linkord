import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useCallFullscreen } from '@/features/calls/useCallFullscreen';

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
}
function setFullscreenEnabled(value: boolean) {
  Object.defineProperty(document, 'fullscreenEnabled', { value, configurable: true });
}

describe('useCallFullscreen', () => {
  afterEach(() => {
    setFullscreenElement(null);
    setFullscreenEnabled(true);
  });

  it('is not fullscreen by default', () => {
    const containerRef = { current: document.createElement('main') } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));
    expect(result.current.isCallFullscreen).toBe(false);
    expect(result.current.fullscreenElement).toBeNull();
  });

  it('isCallFullscreen is only true when the fullscreen element is THIS container, not any element (e.g. a tile)', () => {
    const containerRef = { current: document.createElement('main') } as RefObject<HTMLElement | null>;
    const someTile = document.createElement('div');
    setFullscreenElement(someTile);
    const { result } = renderHook(() => useCallFullscreen(containerRef));
    expect(result.current.isCallFullscreen).toBe(false);
    expect(result.current.fullscreenElement).toBe(someTile);
  });

  it('isCallFullscreen is true when the container itself is fullscreen', () => {
    const container = document.createElement('main');
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    setFullscreenElement(container);
    const { result } = renderHook(() => useCallFullscreen(containerRef));
    expect(result.current.isCallFullscreen).toBe(true);
  });

  it('toggleCallFullscreen calls requestFullscreen on the container when nothing is fullscreen', async () => {
    const container = document.createElement('main');
    const requestFullscreen = vi.fn(async () => undefined);
    container.requestFullscreen = requestFullscreen;
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await act(async () => { await result.current.toggleCallFullscreen(); });
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it('toggleCallFullscreen calls exitFullscreen when something is already fullscreen', async () => {
    const container = document.createElement('main');
    setFullscreenElement(container);
    const exitFullscreen = vi.fn(async () => undefined);
    document.exitFullscreen = exitFullscreen;
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await act(async () => { await result.current.toggleCallFullscreen(); });
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it('without Fullscreen API support (fullscreenEnabled false), does not call requestFullscreen nor throw — silent fallback', async () => {
    setFullscreenEnabled(false);
    const container = document.createElement('main');
    const requestFullscreen = vi.fn(async () => undefined);
    container.requestFullscreen = requestFullscreen;
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await act(async () => { await result.current.toggleCallFullscreen(); });
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('requestFullscreen failing (e.g. blocked) does not propagate an error nor leave state stuck', async () => {
    const container = document.createElement('main');
    container.requestFullscreen = vi.fn(async () => { throw new Error('blocked'); });
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await expect(result.current.toggleCallFullscreen()).resolves.toBeUndefined();
    expect(result.current.isCallFullscreen).toBe(false);
  });
});
