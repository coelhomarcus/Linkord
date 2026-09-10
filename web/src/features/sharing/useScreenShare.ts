import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, ScreenSharePresets, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';

export interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
}

export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const startSharing = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Ainda conectando ao servidor de video, tente de novo em instantes.' });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador nao suporta captura de tela. Use Chrome, Edge ou Firefox no computador.' });
      return;
    }
    if (!window.isSecureContext) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Compartilhar tela exige HTTPS (ou http://localhost pra testar).' });
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
      if (!aborted) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel capturar a tela: ${(err as Error)?.message}` });
      return;
    }

    dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
    dispatch({ type: 'SET_SHARE_ERROR', message: null });

    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    const displaySurface = videoTrack?.mediaStreamTrack.getSettings().displaySurface;
    const gotAudio = !!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);

    if (!gotAudio) {
      let reason: string;
      if (displaySurface === 'window') {
        reason = 'compartilhar uma JANELA nunca inclui audio, em nenhum navegador.';
      } else if (displaySurface === 'monitor') {
        reason = 'tela inteira so vem com audio se a caixa "Tambem compartilhar audio do sistema" estiver marcada (nao existe essa opcao no macOS).';
      } else {
        reason = 'a pessoa desmarcou a opcao de audio, ou o navegador nao suporta audio de tela (ex.: Firefox).';
      }
      console.log(`[screen-share] compartilhado sem audio (displaySurface=${displaySurface ?? 'desconhecido'}): ${reason}`);
    }
  }, [dispatch, room]);

  const stopSharing = useCallback(() => {
    room.localParticipant.setScreenShareEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
  }, [dispatch, room]);

  return { startSharing, stopSharing };
}
