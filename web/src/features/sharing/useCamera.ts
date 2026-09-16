import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, Track, VideoPresets } from 'livekit-client';
import type { Room } from 'livekit-client';
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors';
import type { BackgroundProcessorWrapper } from '@livekit/track-processors';
import type { RoomAction } from '../../state/roomReducer';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { loadBackgroundBlur } from '../settings/useBackgroundBlurPreference';

export interface CameraApi {
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  setBackgroundBlurEnabled: (enabled: boolean) => Promise<void>;
}

const BLUR_RADIUS = 10;

// Lazy singleton — the segmentation model only loads once someone actually
// opts in.
let backgroundProcessor: BackgroundProcessorWrapper | null = null;
function getBackgroundProcessor(): BackgroundProcessorWrapper {
  if (!backgroundProcessor) backgroundProcessor = BackgroundProcessor({ mode: 'background-blur', blurRadius: BLUR_RADIUS });
  return backgroundProcessor;
}

async function applyBackgroundBlur(room: Room, enabled: boolean): Promise<void> {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  const track = pub?.track;
  if (!track) return;
  try {
    if (enabled) {
      if (!supportsBackgroundProcessors()) return;
      await track.setProcessor(getBackgroundProcessor());
    } else if (track.getProcessor()) {
      await track.stopProcessor();
    }
  } catch (err) {
    console.warn('Falha ao aplicar desfoque de fundo', err);
  }
}

export function useCamera(room: Room, dispatch: Dispatch<RoomAction>): CameraApi {
  const startCamera = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Ainda conectando ao servidor de vídeo, tente de novo em instantes.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador não suporta acesso à câmera.' });
      return;
    }

    try {
      // Same reasoning as activateMic (useMicrophone.ts) — a fresh track
      // otherwise starts on whatever device the browser defaults to,
      // ignoring the one saved in Settings.
      const savedDeviceId = loadDevicePreference('videoinput');
      await room.localParticipant.setCameraEnabled(
        true,
        { resolution: { width: 1280, height: 720, frameRate: 30 }, ...(savedDeviceId ? { deviceId: savedDeviceId } : {}) },
        { videoEncoding: VideoPresets.h720.encoding },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: `Não foi possível acessar a câmera: ${(err as Error)?.message}` });
      return;
    }

    if (loadBackgroundBlur()) await applyBackgroundBlur(room, true);
    dispatch({ type: 'SET_LOCAL_CAMERA', on: true });
  }, [dispatch, room]);

  const stopCamera = useCallback(() => {
    room.localParticipant.setCameraEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
  }, [dispatch, room]);

  // Called when the "Desfocar fundo" switch in Settings changes while a
  // camera track already exists — startCamera only reads the saved
  // preference on (re)activation, so a live toggle needs to reach the
  // running track too.
  const setBackgroundBlurEnabled = useCallback((enabled: boolean) => applyBackgroundBlur(room, enabled), [room]);

  return { startCamera, stopCamera, setBackgroundBlurEnabled };
}
