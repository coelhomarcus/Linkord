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

  it('nao esta em tela cheia por padrao', () => {
    const containerRef = { current: document.createElement('main') } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));
    expect(result.current.isCallFullscreen).toBe(false);
    expect(result.current.fullscreenElement).toBeNull();
  });

  it('isCallFullscreen so e true quando o elemento em tela cheia e ESTE container, nao qualquer um (ex: um tile)', () => {
    const containerRef = { current: document.createElement('main') } as RefObject<HTMLElement | null>;
    const someTile = document.createElement('div');
    setFullscreenElement(someTile);
    const { result } = renderHook(() => useCallFullscreen(containerRef));
    expect(result.current.isCallFullscreen).toBe(false);
    expect(result.current.fullscreenElement).toBe(someTile);
  });

  it('isCallFullscreen e true quando o proprio container esta em tela cheia', () => {
    const container = document.createElement('main');
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    setFullscreenElement(container);
    const { result } = renderHook(() => useCallFullscreen(containerRef));
    expect(result.current.isCallFullscreen).toBe(true);
  });

  it('toggleCallFullscreen chama requestFullscreen no container quando nada esta em tela cheia', async () => {
    const container = document.createElement('main');
    const requestFullscreen = vi.fn(async () => undefined);
    container.requestFullscreen = requestFullscreen;
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await act(async () => { await result.current.toggleCallFullscreen(); });
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it('toggleCallFullscreen chama exitFullscreen quando algo ja esta em tela cheia', async () => {
    const container = document.createElement('main');
    setFullscreenElement(container);
    const exitFullscreen = vi.fn(async () => undefined);
    document.exitFullscreen = exitFullscreen;
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await act(async () => { await result.current.toggleCallFullscreen(); });
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it('sem suporte a Fullscreen API (fullscreenEnabled false), nao chama requestFullscreen nem quebra — fallback silencioso', async () => {
    setFullscreenEnabled(false);
    const container = document.createElement('main');
    const requestFullscreen = vi.fn(async () => undefined);
    container.requestFullscreen = requestFullscreen;
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await act(async () => { await result.current.toggleCallFullscreen(); });
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('requestFullscreen falhando (ex: bloqueado) nao propaga erro nem deixa estado preso', async () => {
    const container = document.createElement('main');
    container.requestFullscreen = vi.fn(async () => { throw new Error('blocked'); });
    const containerRef = { current: container } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useCallFullscreen(containerRef));

    await expect(result.current.toggleCallFullscreen()).resolves.toBeUndefined();
    expect(result.current.isCallFullscreen).toBe(false);
  });
});
