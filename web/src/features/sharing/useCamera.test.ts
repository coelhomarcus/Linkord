import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState, VideoPresets } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useCamera } from './useCamera';
import { saveDevicePreference } from '../settings/useDevicePreference';

function fakeRoom(setCameraEnabled = vi.fn(async () => undefined)) {
  return {
    state: ConnectionState.Connected,
    localParticipant: { setCameraEnabled },
  } as unknown as Room;
}

describe('useCamera — startCamera aplica a camera salva', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('passa o deviceId salvo em Configuracoes pro setCameraEnabled, mantendo a resolucao', async () => {
    saveDevicePreference('videoinput', 'cam-preferida');
    const setCameraEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setCameraEnabled);
    const { result } = renderHook(() => useCamera(room, vi.fn()));

    await result.current.startCamera();

    expect(setCameraEnabled).toHaveBeenCalledWith(
      true,
      { resolution: { width: 1280, height: 720, frameRate: 30 }, deviceId: 'cam-preferida' },
      { videoEncoding: VideoPresets.h720.encoding },
    );
  });

  it('sem preferencia salva, nao inclui deviceId nas opcoes de captura', async () => {
    const setCameraEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setCameraEnabled);
    const { result } = renderHook(() => useCamera(room, vi.fn()));

    await result.current.startCamera();

    expect(setCameraEnabled).toHaveBeenCalledWith(
      true,
      { resolution: { width: 1280, height: 720, frameRate: 30 } },
      { videoEncoding: VideoPresets.h720.encoding },
    );
  });
});
