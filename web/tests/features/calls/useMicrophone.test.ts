import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useMicrophone } from '@/features/calls/useMicrophone';
import { saveDevicePreference } from '@/features/settings/useDevicePreference';
import { saveNoiseSuppression } from '@/features/settings/useNoiseSuppressionPreference';

vi.mock('@/features/calls/rnnoiseAudioProcessor', () => ({
  getRnnoiseProcessor: () => ({ name: 'rnnoise-noise-suppression' }),
}));

function fakeTrack() {
  return {
    setProcessor: vi.fn(async () => undefined),
    getProcessor: vi.fn((): { name: string } | undefined => undefined),
    stopProcessor: vi.fn(async () => undefined),
    applyConstraints: vi.fn(async (_constraints?: { noiseSuppression: boolean }) => undefined),
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
    // jsdom doesn't implement mediaDevices — without this, activateMic bails
    // early (with an "unsupported browser" error) before even checking the
    // saved deviceId.
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

describe('useMicrophone — microfone ausente ou bloqueado', () => {
  let deviceChangeListeners: Array<() => void>;

  beforeEach(() => {
    deviceChangeListeners = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(),
        addEventListener: vi.fn((_type: string, fn: () => void) => { deviceChangeListeners.push(fn); }),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  it('sem nenhum microfone (NotFoundError), marca o problema em vez de um erro dispensavel', async () => {
    const room = fakeRoom(vi.fn(async () => { throw new DOMException('Requested device not found', 'NotFoundError'); }));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useMicrophone(room, dispatch));

    await result.current.activateMic();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MIC_PROBLEM', problem: 'not-found' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR' }));
  });

  it('permissao negada (NotAllowedError) vira o problema "denied"', async () => {
    const room = fakeRoom(vi.fn(async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useMicrophone(room, dispatch));

    await result.current.activateMic();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MIC_PROBLEM', problem: 'denied' });
  });

  it('conectar um microfone no meio da chamada tenta ativar de novo e limpa o problema', async () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    setMicrophoneEnabled.mockRejectedValueOnce(new DOMException('Requested device not found', 'NotFoundError'));
    const room = fakeRoom(setMicrophoneEnabled);
    const dispatch = vi.fn();
    const { result } = renderHook(() => useMicrophone(room, dispatch));
    await result.current.activateMic();

    for (const fn of deviceChangeListeners) fn();
    await vi.waitFor(() => expect(setMicrophoneEnabled).toHaveBeenCalledTimes(2));

    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_MIC_PROBLEM', problem: null });
  });

  it('com permissao negada, conectar um dispositivo nao dispara nova tentativa sozinha', async () => {
    const setMicrophoneEnabled = vi.fn(async () => { throw new DOMException('Permission denied', 'NotAllowedError'); });
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));
    await result.current.activateMic();

    for (const fn of deviceChangeListeners) fn();

    expect(setMicrophoneEnabled).toHaveBeenCalledTimes(1);
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

    const outcome = await result.current.setNoiseSuppressionEnabled(true);

    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(outcome).toBe('failed');
  });

  it('processor anexa mas a constraint nativa falha: para o processor em vez de deixar as duas ligadas', async () => {
    const track = fakeTrack();
    // setProcessor "succeeding" means the track is now really attached —
    // getProcessor has to reflect that for the rest of this test to mean
    // anything (fakeTrack's default always returns undefined otherwise).
    track.setProcessor.mockImplementation(async () => {
      track.getProcessor.mockReturnValue({ name: 'rnnoise-noise-suppression' });
    });
    track.applyConstraints.mockRejectedValueOnce(new Error('constraint recusada'));
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    const outcome = await result.current.setNoiseSuppressionEnabled(true);

    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('failed');
  });

  it('sem track ativo (fora de chamada), so avisa que nao ha nada pra aplicar agora', async () => {
    const room = fakeRoom(vi.fn(async () => undefined), undefined);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    const outcome = await result.current.setNoiseSuppressionEnabled(true);

    expect(outcome).toBe('no-active-track');
  });

  it('duas trocas seguidas aplicam em ordem, nao em paralelo', async () => {
    const track = fakeTrack();
    const applyOrder: string[] = [];
    track.applyConstraints.mockImplementation(async (constraints) => {
      applyOrder.push(constraints?.noiseSuppression ? 'native-on' : 'native-off');
    });
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await Promise.all([
      result.current.setNoiseSuppressionEnabled(true),
      result.current.setNoiseSuppressionEnabled(false),
    ]);

    // whichever order they were fired in, they must not interleave —
    // the second call's whole apply only starts once the first is done
    expect(applyOrder).toEqual(['native-off', 'native-on']);
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
