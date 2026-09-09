import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, VideoPresets } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';

export interface CameraApi {
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

/**
 * Turns your own camera (video only) on/off, published as a track on the
 * LiveKit Room. The microphone is independent (see useMicrophone.ts) —
 * each toggles on its own.
 */
export function useCamera(room: Room, dispatch: Dispatch<RoomAction>): CameraApi {
  const startCamera = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Ainda conectando ao servidor de video, tente de novo em instantes.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador nao suporta acesso a camera.' });
      return;
    }

    try {
      await room.localParticipant.setCameraEnabled(
        true,
        { resolution: { width: 1280, height: 720, frameRate: 30 } },
        // matches the fixed capture resolution above — simulcast (on by
        // default) + the Room's adaptiveStream/dynacast (see
        // RoomProvider.tsx) pick the right layer per viewer automatically.
        { videoEncoding: VideoPresets.h720.encoding },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel acessar a camera: ${(err as Error)?.message}` });
      return;
    }

    dispatch({ type: 'SET_LOCAL_CAMERA', on: true });
  }, [dispatch, room]);

  const stopCamera = useCallback(() => {
    room.localParticipant.setCameraEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
  }, [dispatch, room]);

  return { startCamera, stopCamera };
}
