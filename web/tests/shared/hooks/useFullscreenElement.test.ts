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

  it('comeca refletindo o document.fullscreenElement atual (nao so null por padrao)', () => {
    const el = document.createElement('div');
    setFullscreenElement(el);
    const { result } = renderHook(() => useFullscreenElement());
    expect(result.current).toBe(el);
  });

  it('sem nada em tela cheia, comeca null', () => {
    const { result } = renderHook(() => useFullscreenElement());
    expect(result.current).toBeNull();
  });

  it('atualiza quando "fullscreenchange" dispara — cobre Escape/F11 saindo sem passar pelo app', () => {
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
