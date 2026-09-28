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

  it('comeca visivel', () => {
    const { result } = renderHook(() => useCallHud(false));
    expect(result.current.hudVisible).toBe(true);
  });

  it('some sozinho depois do tempo ocioso (2500ms), sem nenhuma atividade', () => {
    const { result } = renderHook(() => useCallHud(false));
    expect(result.current.hudVisible).toBe(true);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.hudVisible).toBe(false);
  });

  it('mover o mouse antes do tempo acabar reinicia a contagem — nao some', () => {
    const { result } = renderHook(() => useCallHud(false));

    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new Event('mousemove')); });
    act(() => { vi.advanceTimersByTime(2000); });
    // 4000ms se passaram no total, mas a ultima atividade foi ha so 2000ms
    expect(result.current.hudVisible).toBe(true);
  });

  it('tecla ou toque tambem contam como atividade, nao so o mouse', () => {
    const { result } = renderHook(() => useCallHud(false));
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.hudVisible).toBe(true);

    act(() => { window.dispatchEvent(new Event('touchstart')); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.hudVisible).toBe(true);
  });

  it('suspend=true mantem sempre visivel, mesmo depois de muito tempo parado', () => {
    const { result } = renderHook(() => useCallHud(true));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.hudVisible).toBe(true);
  });

  it('suspend passando de false pra true forca revelar de novo (ex: um menu abriu)', () => {
    const { result, rerender } = renderHook(({ suspend }) => useCallHud(suspend), { initialProps: { suspend: false } });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.hudVisible).toBe(false);

    rerender({ suspend: true });
    expect(result.current.hudVisible).toBe(true);

    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.hudVisible).toBe(true);
  });

  it('revealHud() forca visivel e reinicia a contagem imediatamente', () => {
    const { result } = renderHook(() => useCallHud(false));
    act(() => { vi.advanceTimersByTime(2400); });
    act(() => { result.current.revealHud(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.hudVisible).toBe(true);
  });
});
