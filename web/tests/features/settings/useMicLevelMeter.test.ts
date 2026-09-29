import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMicLevelMeter } from '@/features/settings/useMicLevelMeter';

function fakeTrack() {
  return { stop: vi.fn(), kind: 'audio' };
}

function fakeStream(tracks = [fakeTrack()]) {
  return { getTracks: () => tracks };
}

let getUserMedia: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;
let rafCallbacks: FrameRequestCallback[];

class FakeAnalyser {
  fftSize = 2048;
  frequencyBinCount = 1024;
  getByteTimeDomainData(arr: Uint8Array) { arr.fill(128); }
}

class FakeAudioContext {
  createMediaStreamSource() { return { connect: vi.fn() }; }
  createAnalyser() { return new FakeAnalyser(); }
  close = closeMock;
}

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCallbacks.push(cb); return rafCallbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  closeMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMicLevelMeter', () => {
  it('does not start on its own — only after an explicit start()', () => {
    renderHook(() => useMicLevelMeter());
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('start() opens the mic with the requested deviceId, without touching room.localParticipant', async () => {
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start('mic-1'); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-1' } } });
    expect(result.current.active).toBe(true);
  });

  it('stop() stops every track and closes the AudioContext', async () => {
    const track = fakeTrack();
    getUserMedia.mockResolvedValue(fakeStream([track]));
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start(); });

    act(() => result.current.stop());
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
    expect(result.current.level).toBe(0);
  });

  it('unmounting without calling stop() still releases the mic (no leak)', async () => {
    const track = fakeTrack();
    getUserMedia.mockResolvedValue(fakeStream([track]));
    const { result, unmount } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start(); });

    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('a second start() stops the first before opening another (no two simultaneous streams)', async () => {
    const trackA = fakeTrack();
    const trackB = fakeTrack();
    getUserMedia.mockResolvedValueOnce(fakeStream([trackA])).mockResolvedValueOnce(fakeStream([trackB]));
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start('mic-1'); });
    await act(async () => { await result.current.start('mic-2'); });

    expect(trackA.stop).toHaveBeenCalledTimes(1);
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'mic-2' } } });
  });

  it('deviceId "default" (LiveKit\'s sentinel for "no choice made yet") does not become an exact constraint', async () => {
    // a real deviceId is never the string "default" — using exact here fails
    // with OverconstrainedError on any real device (only found live).
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start('default'); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('permission denied shows its own error, without locking active at true', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start(); });
    expect(result.current.active).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
