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

describe('useScreenShare — quality applied to the capture', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('without a saved preference, uses the default preset (1080p/30) — same as previous behavior', async () => {
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

  it('with a saved quality preference, the next capture uses the chosen preset', async () => {
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

describe('useScreenShare — changing source', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  it('stops the current capture and reopens a new picker (ends, then starts again)', async () => {
    const setScreenShareEnabled = vi.fn(async () => undefined);
    const room = fakeRoom({ setScreenShareEnabled });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.changeSource();

    expect(setScreenShareEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setScreenShareEnabled).toHaveBeenNthCalledWith(2, true, expect.any(Object), expect.any(Object));
  });

  it('cancelling the picker while changing source does not leave "sharing" stuck at true', async () => {
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

describe('useScreenShare — pause/resume own preview', () => {
  it('pausing calls mute() on the existing publication, without ending the share', async () => {
    const mute = vi.fn(async () => undefined);
    const room = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute, unmute: vi.fn() })) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.pauseSharePreview();

    expect(mute).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_LOCAL_SHARING' }));
  });

  it('resuming calls unmute() on the existing publication', async () => {
    const unmute = vi.fn(async () => undefined);
    const room = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute: vi.fn(), unmute })) });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.resumeSharePreview();

    expect(unmute).toHaveBeenCalled();
  });

  it('without a screen publication (not sharing), pause/resume do nothing and do not break', async () => {
    const room = fakeRoom({ getTrackPublication: vi.fn(() => undefined) });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await expect(result.current.pauseSharePreview()).resolves.toBeUndefined();
    await expect(result.current.resumeSharePreview()).resolves.toBeUndefined();
  });

  it('failing to pause reports the error, without leaving the state stuck', async () => {
    const mute = vi.fn(async () => { throw new Error('boom'); });
    const room = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute, unmute: vi.fn() })) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.pauseSharePreview();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('pausar') }));
  });
});

describe('useScreenShare — audio loopback guard', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia: vi.fn() }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  function roomSharing(displaySurface: string, audioSettings: Record<string, unknown> | null) {
    const unpublishTrack = vi.fn(async () => undefined);
    const audioTrack = audioSettings ? { mediaStreamTrack: { getSettings: () => audioSettings } } : undefined;
    const room = {
      state: ConnectionState.Connected,
      localParticipant: {
        setScreenShareEnabled: vi.fn(async () => undefined),
        unpublishTrack,
        getTrackPublication: vi.fn((source: string) => {
          if (source === 'screen_share') return { track: { mediaStreamTrack: { getSettings: () => ({ displaySurface }) } } };
          if (source === 'screen_share_audio') return audioTrack ? { track: audioTrack } : undefined;
          return undefined;
        }),
      },
    } as unknown as Room;
    return { room, unpublishTrack, audioTrack };
  }

  it('unpublishes the audio of a whole-display capture when the browser could not exclude its own audio', async () => {
    const { room, unpublishTrack, audioTrack } = roomSharing('monitor', {});
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.startSharing();

    expect(unpublishTrack).toHaveBeenCalledWith(audioTrack, true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: true });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('sem áudio') }));
  });

  it('keeps the audio when the browser confirms it excludes its own audio', async () => {
    const { room, unpublishTrack } = roomSharing('monitor', { restrictOwnAudio: true });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    expect(unpublishTrack).not.toHaveBeenCalled();
  });

  it('keeps the audio of a tab or window capture', async () => {
    const { room, unpublishTrack } = roomSharing('browser', {});
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    expect(unpublishTrack).not.toHaveBeenCalled();
  });
});
