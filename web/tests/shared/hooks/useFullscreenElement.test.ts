import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullscreenElement } from '@/shared/hooks/useFullscreenElement';

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
}

describe('useFullscreenElement', () => {
  afterEach(() => {
    setFullscreenElement(null);
  });

  it('starts reflecting the current document.fullscreenElement (not just null by default)', () => {
    const el = document.createElement('div');
    setFullscreenElement(el);
    const { result } = renderHook(() => useFullscreenElement());
    expect(result.current).toBe(el);
  });

  it('starts null when nothing is fullscreen', () => {
    const { result } = renderHook(() => useFullscreenElement());
    expect(result.current).toBeNull();
  });

  it('updates when "fullscreenchange" fires — covers Escape/F11 exiting without going through the app', () => {
    const { result } = renderHook(() => useFullscreenElement());
    expect(result.current).toBeNull();

    const el = document.createElement('div');
    setFullscreenElement(el);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current).toBe(el);

    setFullscreenElement(null);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current).toBeNull();
  });
});
