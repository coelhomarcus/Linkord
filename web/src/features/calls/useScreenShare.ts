import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadShareQuality } from '../settings/useShareQualityPreference';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';

export interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  /** Stops the current capture and immediately opens a fresh native picker
   * — the only way to pick a different window/tab/screen, or to have a
   * quality preference chosen mid-share actually take effect (see the calls
   * redesign plan §8.3: "troca de fonte usa o seletor do navegador"). */
  changeSource: () => Promise<void>;
  /** Mutes the local screen-share publication without unpublishing it — the
   * tile (mine and everyone else's) shows a "prévia pausada" state instead
   * of vanishing, distinct from stopping the share entirely. */
  pauseSharePreview: () => Promise<void>;
  resumeSharePreview: () => Promise<void>;
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

    const quality = SHARE_QUALITY_PRESETS[loadShareQuality()];

    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: audioConstraints,
          resolution: quality.resolution,
          selfBrowserSurface: 'exclude',
        },
        { videoEncoding: quality.encoding },
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

  const changeSource = useCallback(async () => {
    stopSharing();
    await startSharing();
  }, [stopSharing, startSharing]);

  const pauseSharePreview = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (!pub) return;
    try {
      await pub.mute();
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: `Não foi possível pausar a prévia: ${(err as Error)?.message}` });
    }
  }, [room, dispatch]);

  const resumeSharePreview = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (!pub) return;
    try {
      await pub.unmute();
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: `Não foi possível retomar a prévia: ${(err as Error)?.message}` });
    }
  }, [room, dispatch]);

  return { startSharing, stopSharing, changeSource, pauseSharePreview, resumeSharePreview };
}
