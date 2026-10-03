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

describe('useMicrophone — activateMic applies the saved microphone', () => {
  beforeEach(() => {
    // jsdom doesn't implement mediaDevices — without this, activateMic bails
    // early (with an "unsupported browser" error) before even checking the
    // saved deviceId.
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('passes the deviceId saved in Settings to setMicrophoneEnabled', async () => {
    saveDevicePreference('audioinput', 'preferred-mic');
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, { deviceId: 'preferred-mic' });
  });

  it('without a saved preference, does not force any deviceId (lets the browser choose)', async () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true, undefined);
  });

  it('does not activate again if a microphone publication already exists', async () => {
    const setMicrophoneEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setMicrophoneEnabled);
    (room.localParticipant.getTrackPublication as ReturnType<typeof vi.fn>).mockReturnValue({ source: Track.Source.Microphone });
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.activateMic();

    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});

describe('useMicrophone — missing or blocked microphone', () => {
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

  it('with no microphone at all (NotFoundError), marks the problem instead of a dismissible error', async () => {
    const room = fakeRoom(vi.fn(async () => { throw new DOMException('Requested device not found', 'NotFoundError'); }));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useMicrophone(room, dispatch));

    await result.current.activateMic();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MIC_PROBLEM', problem: 'not-found' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR' }));
  });

  it('permission denied (NotAllowedError) becomes the "denied" problem', async () => {
    const room = fakeRoom(vi.fn(async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useMicrophone(room, dispatch));

    await result.current.activateMic();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MIC_PROBLEM', problem: 'denied' });
  });

  it.each(['NotReadableError', 'AbortError'])('a microphone that fails to start (%s) becomes the "unavailable" problem', async (errName) => {
    const room = fakeRoom(vi.fn(async () => { throw new DOMException('Could not start audio source', errName); }));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useMicrophone(room, dispatch));

    await result.current.activateMic();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MIC_PROBLEM', problem: 'unavailable' });
  });

  it('plugging in a microphone mid-call tries to activate again and clears the problem', async () => {
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

  it('with permission denied, plugging in a device does not trigger a new attempt on its own', async () => {
    const setMicrophoneEnabled = vi.fn(async () => { throw new DOMException('Permission denied', 'NotAllowedError'); });
    const room = fakeRoom(setMicrophoneEnabled);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));
    await result.current.activateMic();

    for (const fn of deviceChangeListeners) fn();

    expect(setMicrophoneEnabled).toHaveBeenCalledTimes(1);
  });
});

describe('useMicrophone — noise suppression (RNNoise)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('with the preference on, attaches the RNNoise processor and only then turns off the native suppression', async () => {
    saveNoiseSuppression(true);
    const track = fakeTrack();
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.setNoiseSuppressionEnabled(true);

    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: false });
    // setProcessor must be called before touching the native constraint.
    const setProcessorOrder = track.setProcessor.mock.invocationCallOrder[0];
    const applyConstraintsOrder = track.applyConstraints.mock.invocationCallOrder[0];
    expect(setProcessorOrder).toBeLessThan(applyConstraintsOrder);
  });

  it('if the processor fails to attach, the native suppression is not touched (never left with none at all)', async () => {
    const track = fakeTrack();
    track.setProcessor.mockRejectedValueOnce(new Error('unsupported'));
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    const outcome = await result.current.setNoiseSuppressionEnabled(true);

    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(outcome).toBe('failed');
  });

  it('processor attaches but the native constraint fails: stops the processor instead of leaving both on', async () => {
    const track = fakeTrack();
    // setProcessor "succeeding" means the track is now really attached —
    // getProcessor has to reflect that for the rest of this test to mean
    // anything (fakeTrack's default always returns undefined otherwise).
    track.setProcessor.mockImplementation(async () => {
      track.getProcessor.mockReturnValue({ name: 'rnnoise-noise-suppression' });
    });
    track.applyConstraints.mockRejectedValueOnce(new Error('constraint rejected'));
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    const outcome = await result.current.setNoiseSuppressionEnabled(true);

    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('failed');
  });

  it("without an active track (outside a call), just reports there's nothing to apply right now", async () => {
    const room = fakeRoom(vi.fn(async () => undefined), undefined);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    const outcome = await result.current.setNoiseSuppressionEnabled(true);

    expect(outcome).toBe('no-active-track');
  });

  it('two consecutive toggles apply in order, not in parallel', async () => {
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

  it('when turning off, stops the processor (if any) and re-enables the native suppression', async () => {
    const track = fakeTrack();
    track.getProcessor.mockReturnValue({ name: 'rnnoise-noise-suppression' });
    const room = fakeRoom(vi.fn(async () => undefined), track);
    const { result } = renderHook(() => useMicrophone(room, vi.fn()));

    await result.current.setNoiseSuppressionEnabled(false);

    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: true });
  });

  it('leaveMic stops the processor before leaving, if one is attached', async () => {
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
