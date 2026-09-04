import { useCallback, useState } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadQuality, saveQuality, QUALITY_ENCODINGS, type Quality } from '../settings/useQualityPreference';

export interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  quality: Quality;
  setQuality: (q: Quality) => void;
}

/**
 * Shares the local screen by publishing a video track (and audio, when
 * available) into the LiveKit Room — real WebRTC, no manual recording/
 * queuing. `room` is a single stable instance (created once in
 * RoomProvider); the actual connect() happens per voice channel, see
 * joinVoiceChannel.
 */
export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const [quality, setQualityState] = useState<Quality>(loadQuality);

  const setQuality = useCallback((q: Quality) => {
    setQualityState(q);
    saveQuality(q);
  }, []);

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
      // off on purpose: these are processing meant for mic voice, and
      // degrade tab/system audio (e.g. cutting out music).
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // asks the browser to filter out any audio produced by the Linkord
      // tab ITSELF from the capture. selfBrowserSurface (below) already
      // removes the tab from the "browser tab" picker option, but doesn't
      // cover "entire screen + share system audio" — that mode captures
      // the whole OS mixer, which would still pick up other participants'
      // voices playing back through our own tab. Only has an effect when
      // the captured surface actually includes system audio; browsers
      // without support just ignore it.
      restrictOwnAudio: true,
    };

    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: audioConstraints,
          resolution: { width: 1920, height: 1080, frameRate: 30 },
          // keeps the Linkord tab itself out of the share picker. Without
          // this, someone could pick the call tab, whose audio (via
          // ParticipantAudioLayer) already includes everyone else's voice —
          // sharing that tab sends that audio back into LiveKit, and each
          // participant hears their own voice echo back. Not physical
          // speaker/mic feedback: it's the SAME tab being captured and
          // republished, a software loop.
          selfBrowserSurface: 'exclude',
        },
        { videoEncoding: QUALITY_ENCODINGS[quality] },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const aborted = name === 'NotAllowedError' || name === 'AbortError';
      if (!aborted) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel capturar a tela: ${(err as Error)?.message}` });
      return;
    }

    dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
    // this attempt succeeded — clears any SET_SHARE_ERROR left over from a
    // PREVIOUS attempt (e.g. "still connecting", retried, worked this time).
    dispatch({ type: 'SET_SHARE_ERROR', message: null });

    // getDisplayMedia doesn't always deliver audio, and why varies with
    // what was picked in the browser's share dialog (displaySurface, read
    // off the video MediaStreamTrack that was just published):
    //   'window'  — a WINDOW never has audio, in any browser/OS. A
    //               universal getDisplayMedia restriction, no known exception.
    //   'monitor' — the ENTIRE SCREEN only comes with audio if "Also share
    //               system audio" was checked in Chrome/Edge's dialog —
    //               and that option doesn't even appear on macOS (the OS
    //               doesn't expose audio loopback to the browser outside
    //               its own tab mixer).
    //   'browser' — a browser TAB: the only mode with guaranteed audio on
    //               any system (captures the tab's internal mixer, no OS
    //               loopback needed). If this still comes without audio,
    //               the person unchecked the option.
    // Firefox offers NONE of these with audio (no audio option in its
    // getDisplayMedia UI at all).
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    const displaySurface = videoTrack?.mediaStreamTrack.getSettings().displaySurface;
    const gotAudio = !!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);

    if (!gotAudio) {
      // no audio at all: not a problem for the room (only the sharer
      // misses out on sound), so just log it — no need to surface a
      // warning to every screen/window sharer.
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
  }, [dispatch, room, quality]);

  const stopSharing = useCallback(() => {
    room.localParticipant.setScreenShareEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
  }, [dispatch, room]);

  return { startSharing, stopSharing, quality, setQuality };
}
