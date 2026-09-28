import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useScreenShare } from '@/features/calls/useScreenShare';
import { saveShareQuality } from '@/features/settings/useShareQualityPreference';
import { SHARE_QUALITY_PRESETS } from '@/features/calls/shareQualityPresets';

function fakeRoom(overrides: { setScreenShareEnabled?: ReturnType<typeof vi.fn>; getTrackPublication?: ReturnType<typeof vi.fn> } = {}) {
  return {
    state: ConnectionState.Connected,
    localParticipant: {
      setScreenShareEnabled: overrides.setScreenShareEnabled ?? vi.fn(async () => undefined),
      getTrackPublication: overrides.getTrackPublication ?? vi.fn(() => undefined),
    },
  } as unknown as Room;
}

describe('useScreenShare — qualidade aplicada na captura', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('sem preferencia salva, usa o preset padrao (1080p/30) — igual ao comportamento anterior', async () => {
    const setScreenShareEnabled = vi.fn(async () => undefined);
    const room = fakeRoom({ setScreenShareEnabled });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    expect(setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ resolution: SHARE_QUALITY_PRESETS.standard.resolution }),
      { videoEncoding: SHARE_QUALITY_PRESETS.standard.encoding },
    );
  });

  it('com uma preferencia de qualidade salva, a proxima captura usa o preset escolhido', async () => {
    saveShareQuality('smooth');
    const setScreenShareEnabled = vi.fn(async () => undefined);
    const room = fakeRoom({ setScreenShareEnabled });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    expect(setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ resolution: SHARE_QUALITY_PRESETS.smooth.resolution }),
      { videoEncoding: SHARE_QUALITY_PRESETS.smooth.encoding },
    );
  });
});

describe('useScreenShare — trocar fonte', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  it('para a captura atual e reabre um seletor novo (encerra, depois inicia de novo)', async () => {
    const setScreenShareEnabled = vi.fn(async () => undefined);
    const room = fakeRoom({ setScreenShareEnabled });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.changeSource();

    expect(setScreenShareEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setScreenShareEnabled).toHaveBeenNthCalledWith(2, true, expect.any(Object), expect.any(Object));
  });

  it('cancelar o seletor ao trocar de fonte nao deixa "sharing" travado em true', async () => {
    const dispatch = vi.fn();
    const setScreenShareEnabled = vi.fn()
      .mockImplementationOnce(async () => undefined) // the stop call inside changeSource
      .mockImplementationOnce(async () => { throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }); });
    const room = fakeRoom({ setScreenShareEnabled });
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.changeSource();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: false });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: true });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('capturar') }));
  });
});

describe('useScreenShare — pausar/retomar a propria previa', () => {
  it('pausar chama mute() na publicacao existente, sem encerrar o compartilhamento', async () => {
    const mute = vi.fn(async () => undefined);
    const room = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute, unmute: vi.fn() })) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.pauseSharePreview();

    expect(mute).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_LOCAL_SHARING' }));
  });

  it('retomar chama unmute() na publicacao existente', async () => {
    const unmute = vi.fn(async () => undefined);
    const room = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute: vi.fn(), unmute })) });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.resumeSharePreview();

    expect(unmute).toHaveBeenCalled();
  });

  it('sem publicacao de tela (nao esta compartilhando), pausar/retomar nao fazem nada nem quebram', async () => {
    const room = fakeRoom({ getTrackPublication: vi.fn(() => undefined) });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await expect(result.current.pauseSharePreview()).resolves.toBeUndefined();
    await expect(result.current.resumeSharePreview()).resolves.toBeUndefined();
  });

  it('falha ao pausar reporta o erro, sem deixar o estado travado', async () => {
    const mute = vi.fn(async () => { throw new Error('boom'); });
    const room = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute, unmute: vi.fn() })) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.pauseSharePreview();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('pausar') }));
  });
});
