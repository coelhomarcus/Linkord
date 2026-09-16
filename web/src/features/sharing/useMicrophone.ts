import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { loadNoiseSuppression } from '../settings/useNoiseSuppressionPreference';

export interface MicrophoneApi {
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  setMicMuted: (muted: boolean) => Promise<void>;
  leaveMic: () => Promise<void>;
  setNoiseSuppressionEnabled: (enabled: boolean) => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15000;

// This is the browser/OS-level noiseSuppression constraint on the raw
// capture device — not an AI model. (Krisp's AI-based filter was tried
// first, but it only authorizes against LiveKit Cloud; it 404s on every
// self-hosted LiveKit server, so it was pulled back out entirely.)
async function applyNoiseSuppression(room: Room, enabled: boolean): Promise<void> {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const mediaStreamTrack = pub?.track?.mediaStreamTrack;
  if (!mediaStreamTrack) return;
  try {
    await mediaStreamTrack.applyConstraints({ noiseSuppression: enabled });
  } catch (err) {
    console.warn('Falha ao aplicar supressão de ruído', err);
  }
}

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
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador não suporta acesso ao microfone.' });
      return;
    }

    activatingRef.current = true;
    try {
      await waitForConnection(room);
      // Without this, a freshly created track always starts on whatever
      // device the browser picks by default — the device saved in Settings
      // (useMediaDevices#selectDevice) only ever got applied to an ALREADY
      // active track via room.switchActiveDevice, called from within the
      // Settings modal itself. Activating the mic without opening Settings
      // first (the common case — a call's mic button) never consulted it,
      // so the choice looked like it "didn't stick".
      const savedDeviceId = loadDevicePreference('audioinput');
      await room.localParticipant.setMicrophoneEnabled(true, {
        noiseSuppression: loadNoiseSuppression(),
        ...(savedDeviceId ? { deviceId: savedDeviceId } : {}),
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        dispatch({ type: 'SET_SHARE_ERROR', message: 'Não foi possível conectar ao servidor de vídeo. Verifique sua conexão e tente de novo.' });
        return;
      }
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: `Não foi possível acessar o microfone: ${(err as Error)?.message}` });
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

  // Called when the "Supressão de ruído" switch in Settings changes while a
  // mic track already exists — activateMic only reads the saved preference
  // on (re)activation, so a live toggle needs to reach the running track too.
  const setNoiseSuppressionEnabled = useCallback((enabled: boolean) => applyNoiseSuppression(room, enabled), [room]);

  return { activateMic, toggleMicMuted, setMicMuted, leaveMic, setNoiseSuppressionEnabled };
}
