import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoFocusScreenShare } from '@/features/calls/useAutoFocusScreenShare';
import type { TileDescriptor } from '@/features/calls/tileTypes';

const tile = (key: string, kind: TileDescriptor['kind']): TileDescriptor => ({
  key, participantId: key.split(':')[0]!, kind, loading: false, paused: false,
});

describe('useAutoFocusScreenShare', () => {
  it('nao foca nada na primeira renderizacao, mesmo se ja existir uma tela compartilhada', () => {
    const onAutoFocus = vi.fn();
    renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [tile('p1:screen', 'screen')], origin: null as 'manual' | 'automatic' | null },
    });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });

  it('foca quando uma tela nova aparece depois da primeira renderizacao', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: null });
    expect(onAutoFocus).toHaveBeenCalledWith('p1:screen');
  });

  it('nunca substitui um foco manual ativo', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: 'manual' as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:screen', 'screen')], origin: 'manual' });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });

  it('uma segunda tela nova ainda pode sugerir foco automatico se a origem nao e manual', () => {
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

  it('tiles de camera/avatar nao disparam foco automatico', () => {
    const onAutoFocus = vi.fn();
    const { rerender } = renderHook(({ descriptors, origin }) => useAutoFocusScreenShare(descriptors, origin, onAutoFocus), {
      initialProps: { descriptors: [] as TileDescriptor[], origin: null as 'manual' | 'automatic' | null },
    });
    rerender({ descriptors: [tile('p1:participant', 'camera')], origin: null });
    expect(onAutoFocus).not.toHaveBeenCalled();
  });

  it('uma tela que some e reaparece com a mesma chave nao dispara de novo (ainda "vista")', () => {
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
