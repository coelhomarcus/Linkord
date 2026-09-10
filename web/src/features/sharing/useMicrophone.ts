import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';

export interface MicrophoneApi {
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  setMicMuted: (muted: boolean) => Promise<void>;
  leaveMic: () => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15000;

function waitForConnection(room: Room): Promise<void> {
  if (room.state === ConnectionState.Connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, CONNECT_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, onConnected);
    }
    function onConnected() { cleanup(); resolve(); }
    room.once(RoomEvent.Connected, onConnected);
  });
}

export function useMicrophone(room: Room, dispatch: Dispatch<RoomAction>): MicrophoneApi {
  const activatingRef = useRef(false);

  const activateMic = useCallback(async () => {
    if (activatingRef.current) return;
    if (room.localParticipant.getTrackPublication(Track.Source.Microphone)) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador nao suporta acesso ao microfone.' });
      return;
    }

    activatingRef.current = true;
    try {
      await waitForConnection(room);
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        dispatch({ type: 'SET_SHARE_ERROR', message: 'Nao foi possivel conectar ao servidor de video. Verifique sua conexao e tente de novo.' });
        return;
      }
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel acessar o microfone: ${(err as Error)?.message}` });
    } finally {
      activatingRef.current = false;
    }
  }, [dispatch, room]);

  const toggleMicMuted = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub) return;
    const wasMuted = pub.isMuted;
    await room.localParticipant.setMicrophoneEnabled(wasMuted);
    playSound(wasMuted ? 'unmuted' : 'muted');
  }, [room]);

  const setMicMuted = useCallback(async (muted: boolean) => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub) return;
    await room.localParticipant.setMicrophoneEnabled(!muted);
  }, [room]);

  const leaveMic = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub?.track) await room.localParticipant.unpublishTrack(pub.track, true);
  }, [room]);

  return { activateMic, toggleMicMuted, setMicMuted, leaveMic };
}
