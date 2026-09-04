import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { QUALITY_ENCODINGS, type Quality } from '../settings/useQualityPreference';

export interface CameraApi {
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

/**
 * Turns your own camera (video only) on/off, published as a track on the
 * LiveKit Room. The microphone is independent (see useMicrophone.ts) —
 * each toggles on its own.
 */
export function useCamera(room: Room, dispatch: Dispatch<RoomAction>, quality: Quality): CameraApi {
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
        { videoEncoding: QUALITY_ENCODINGS[quality] },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel acessar a camera: ${(err as Error)?.message}` });
      return;
    }

    dispatch({ type: 'SET_LOCAL_CAMERA', on: true });
  }, [dispatch, room, quality]);

  const stopCamera = useCallback(() => {
    room.localParticipant.setCameraEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
  }, [dispatch, room]);

  return { startCamera, stopCamera };
}
