import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useMicrophone } from './useMicrophone';
import { saveDevicePreference } from '../settings/useDevicePreference';
import { saveNoiseSuppression } from '../settings/useNoiseSuppressionPreference';

function fakeRoom(setMicrophoneEnabled = vi.fn(async () => undefined)) {
  return {
    state: ConnectionState.Connected,
    localParticipant: {
      getTrackPublication: vi.fn(() => undefined),
      setMicrophoneEnabled,
    },
  } as unknown as Room;
}

describe('useMicrophone — activateMic aplica o microfone salvo', () => {
  beforeEach(() => {
    // jsdom nao implementa mediaDevices — activateMic sai cedo (com um erro
    // de "navegador nao suportado") sem isso, antes mesmo de checar o
    // deviceId salvo.
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('passa o deviceId salvo em Configuracoes pro setMicrophoneEnabled', async () => {
    saveDevicePreference('audioinput', 'mic-preferido');
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, { noiseSuppression: false, deviceId: 'mic-preferido' });
  });

  it('sem preferencia salva, nao forca nenhum deviceId (deixa o navegador escolher)', async () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, { noiseSuppression: false });
  });

  it('com supressao de ruido ligada em Configuracoes, ativa o mic com noiseSuppression: true', async () => {
    saveNoiseSuppression(true);
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, { noiseSuppression: true });
  });

  it('nao ativa de novo se ja existe uma publicacao de microfone', async () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    (room.localParticipant.getTrackPublication as ReturnType<typeof vi.fn>).mockReturnValue({ source: Track.Source.Microphone });
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});
