import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useMicrophone } from './useMicrophone';
import { saveDevicePreference } from '../settings/useDevicePreference';
import { saveNoiseSuppression } from '../settings/useNoiseSuppressionPreference';

vi.mock('./rnnoiseAudioProcessor', () => ({
  getRnnoiseProcessor: () => ({ name: 'rnnoise-noise-suppression' }),
}));

function fakeTrack() {
  return {
    setProcessor: vi.fn(async () => undefined),
    getProcessor: vi.fn((): { name: string } | undefined => undefined),
    stopProcessor: vi.fn(async () => undefined),
    applyConstraints: vi.fn(async () => undefined),
  };
}

function fakeRoom(setMicrophoneEnabled = vi.fn(async () => undefined), track: ReturnType<typeof fakeTrack> | undefined = undefined) {
  return {
    state: ConnectionState.Connected,
    localParticipant: {
      getTrackPublication: vi.fn(() => (track ? { source: Track.Source.Microphone, track } : undefined)),
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

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, { deviceId: 'mic-preferido' });
  });

  it('sem preferencia salva, nao forca nenhum deviceId (deixa o navegador escolher)', async () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, undefined);
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

describe('useMicrophone — supressao de ruido (RNNoise)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('com a preferencia ligada, anexa o processor RNNoise e so entao desliga a supressao nativa', async () => {
    saveNoiseSuppression(true);
    const track = fakeTrack();
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.setNoiseSuppressionEnabled(true);

    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: false });
    // setProcessor deve ser chamado antes de mexer na constraint nativa.
    const setProcessorOrder = track.setProcessor.mock.invocationCallOrder[0];
    const applyConstraintsOrder = track.applyConstraints.mock.invocationCallOrder[0];
    expect(setProcessorOrder).toBeLessThan(applyConstraintsOrder);
  });

  it('se o processor falhar ao anexar, a supressao nativa nao e tocada (nunca fica sem nenhuma)', async () => {
    const track = fakeTrack();
    track.setProcessor.mockRejectedValueOnce(new Error('sem suporte'));
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.setNoiseSuppressionEnabled(true);

    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('ao desligar, para o processor (se houver) e religa a supressao nativa', async () => {
    const track = fakeTrack();
    track.getProcessor.mockReturnValue({ name: 'rnnoise-noise-suppression' });
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.setNoiseSuppressionEnabled(false);

    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: true });
  });

  it('leaveMic para o processor antes de sair, se um estiver anexado', async () => {
    const track = fakeTrack();
    track.getProcessor.mockReturnValue({ name: 'rnnoise-noise-suppression' });
    const unpublishTrack = vi.fn(async () => undefined);
    const room = fakeRoom(vi.fn(async () => undefined), track);
    (room.localParticipant as unknown as { unpublishTrack: typeof unpublishTrack }).unpublishTrack = unpublishTrack;
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.leaveMic();

    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
    expect(unpublishTrack).toHaveBeenCalledWith(track, true);
  });
});
