import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { LocalAudioTrack, Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { loadNoiseSuppression } from '../settings/useNoiseSuppressionPreference';
import { getRnnoiseProcessor } from './rnnoiseAudioProcessor';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'mic' });

/** `applied`: the requested state (on RNNoise, or off it) is really what's
 * running now. `no-active-track`: not in a call — nothing to apply, the
 * preference is just persisted for the next activateMic(). `failed`: tried
 * to attach RNNoise and it didn't work; the caller should not represent the
 * switch as on when it isn't. */
export type NoiseSuppressionResult = 'applied' | 'no-active-track' | 'failed';

export interface MicrophoneApi {
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  setMicMuted: (muted: boolean) => Promise<void>;
  leaveMic: () => Promise<void>;
  setNoiseSuppressionEnabled: (enabled: boolean) => Promise<NoiseSuppressionResult>;
}

const CONNECT_TIMEOUT_MS = 15000;

// RNNoise (rnnoiseAudioProcessor.ts) is the real AI-based denoiser — it runs
// entirely on-device (no cloud entitlement needed, unlike Krisp, which was
// tried first and pulled back out because it 404s on every self-hosted
// LiveKit server). The browser's own noiseSuppression constraint is only
// touched here as a fallback: it's turned off once RNNoise confirms it's
// actually attached (running both would double-process the signal), and
// re-asserted if RNNoise fails or gets turned off, so the mic is never left
// with NEITHER — same discipline that had to be fixed for Krisp.
async function applyNoiseSuppression(room: Room, enabled: boolean): Promise<NoiseSuppressionResult> {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = pub?.track as LocalAudioTrack | undefined;
  if (!track) return 'no-active-track';

  if (enabled) {
    try {
      // Must attach the processor BEFORE touching the constraint: once
      // attached, LocalTrack.mediaStreamTrack starts returning RNNoise's
      // synthetic output instead of the raw capture, and applyConstraints
      // (unlike that getter) is deliberately routed at the raw track
      // internally, so this order is what keeps it targeting the real mic.
      await track.setProcessor(getRnnoiseProcessor());
      await track.applyConstraints({ noiseSuppression: false });
      return 'applied';
    } catch (err) {
      log.warn('Failed to enable noise suppression (RNNoise); keeping the browser\'s native suppression', { err: String(err) });
      // setProcessor can succeed and the applyConstraints right after it
      // still throw — without this, RNNoise stays attached AND the native
      // suppression stays on too, the exact double-processing the "off"
      // branch below is careful to avoid.
      if (track.getProcessor()) await track.stopProcessor().catch(() => {});
      return 'failed';
    }
  }

  if (track.getProcessor()) await track.stopProcessor().catch(() => {});
  await track.applyConstraints({ noiseSuppression: true }).catch((err) => {
    log.warn('Failed to apply noise suppression', { err: String(err) });
  });
  return 'applied';
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
      await room.localParticipant.setMicrophoneEnabled(true, savedDeviceId ? { deviceId: savedDeviceId } : undefined);
      if (loadNoiseSuppression()) await applyNoiseSuppression(room, true);
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        dispatch({ type: 'SET_SHARE_ERROR', message: 'Não foi possível conectar ao servidor de vídeo. Verifique sua conexão e tente de novo.' });
        return;
      }
      const name = (err as DOMException)?.name;
      // NotFoundError gets its own message (unlike the other call/camera
      // activation flows, which stay silent on it): this one runs
      // automatically on every call join, so a silent failure here reads as
      // "the call is broken" rather than "there's no mic plugged in".
      if (name === 'NotFoundError') {
        dispatch({ type: 'SET_SHARE_ERROR', message: 'Nenhum microfone encontrado. Você entrou na call, mas ninguém vai te ouvir até conectar um microfone.' });
        return;
      }
      const denied = name === 'NotAllowedError' || name === 'AbortError';
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
    const track = pub?.track as LocalAudioTrack | undefined;
    if (!track) return;
    // Without this, the RNNoise AudioWorkletNode + its WASM state leak on
    // the Room's shared AudioContext every time someone leaves a call with
    // noise suppression on — unpublishTrack() only stops the raw
    // MediaStreamTrack, it doesn't know about attached processors.
    if (track.getProcessor()) await track.stopProcessor().catch(() => {});
    await room.localParticipant.unpublishTrack(track, true);
  }, [room]);

  // Called when the "Supressão de ruído" switch in Settings changes while a
  // mic track already exists — activateMic only reads the saved preference
  // on (re)activation, so a live toggle needs to reach the running track too.
  // Chained off the last call (not fired in parallel): flipping the switch
  // twice quickly must apply in order, not race two setProcessor calls on
  // the same track against each other.
  const noiseSuppressionQueueRef = useRef<Promise<NoiseSuppressionResult>>(Promise.resolve('applied'));
  const setNoiseSuppressionEnabled = useCallback((enabled: boolean) => {
    const next = noiseSuppressionQueueRef.current
      .catch(() => 'failed' as const)
      .then(() => applyNoiseSuppression(room, enabled));
    noiseSuppressionQueueRef.current = next;
    return next;
  }, [room]);

  return { activateMic, toggleMicMuted, setMicMuted, leaveMic, setNoiseSuppressionEnabled };
}
