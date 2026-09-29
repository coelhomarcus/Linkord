import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState, VideoPresets } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useCamera } from '@/features/calls/useCamera';
import { saveDevicePreference } from '@/features/settings/useDevicePreference';

function fakeRoom(setCameraEnabled = vi.fn(async () => undefined)) {
  return {
    state: ConnectionState.Connected,
    localParticipant: { setCameraEnabled },
  } as unknown as Room;
}

describe('useCamera — startCamera applies the saved camera', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('passes the deviceId saved in Settings to setCameraEnabled, keeping the resolution', async () => {
    saveDevicePreference('videoinput', 'preferred-camera');
    const setCameraEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setCameraEnabled);
    const { result } = renderHook(() => useCamera(room, vi.fn()));

    await result.current.startCamera();

    expect(setCameraEnabled).toHaveBeenCalledWith(
      true,
      { resolution: { width: 1280, height: 720, frameRate: 30 }, deviceId: 'preferred-camera' },
      { videoEncoding: VideoPresets.h720.encoding },
    );
  });

  it('without a saved preference, does not include deviceId in the capture options', async () => {
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
