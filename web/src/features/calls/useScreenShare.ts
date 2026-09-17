import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, ScreenSharePresets } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';

export interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
}

export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const startSharing = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Ainda conectando ao servidor de vídeo, tente de novo em instantes.' });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador não suporta captura de tela. Use Chrome, Edge ou Firefox no computador.' });
      return;
    }
    if (!window.isSecureContext) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Compartilhar tela exige HTTPS (ou http://localhost para testar).' });
      return;
    }

    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      restrictOwnAudio: true,
    };

    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: audioConstraints,
          resolution: { width: 1920, height: 1080, frameRate: 30 },
          selfBrowserSurface: 'exclude',
        },
        { videoEncoding: ScreenSharePresets.h1080fps30.encoding },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const aborted = name === 'NotAllowedError' || name === 'AbortError';
      if (!aborted) dispatch({ type: 'SET_SHARE_ERROR', message: `Não foi possível capturar a tela: ${(err as Error)?.message}` });
      return;
    }

    dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
    dispatch({ type: 'SET_SHARE_ERROR', message: null });
  }, [dispatch, room]);

  const stopSharing = useCallback(() => {
    room.localParticipant.setScreenShareEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
  }, [dispatch, room]);

  return { startSharing, stopSharing };
}
