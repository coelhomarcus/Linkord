import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';

export interface MicrophoneApi {
  /** Requests permission and publishes the mic once per session in the
   * requested initial mute state. Idempotent — safe to call again (e.g.
   * retry after permission denied, or the caller remounting). */
  activateMic: (options?: MicrophoneActivationOptions) => Promise<MicrophoneActivationResult>;
  /** Only toggles muted/unmuted — assumes activateMic already ran. */
  toggleMicMuted: () => Promise<void>;
  /** Forces a specific state (doesn't toggle) — used by "deafen", which
   * needs to GUARANTEE muted when turning on, not toggle whatever it was.
   * No-op without an activated mic, same guard as toggleMicMuted. */
  setMicMuted: (muted: boolean) => Promise<void>;
  /** Actually leaves the call — unpublishes the track
   * (setMicrophoneEnabled(false) only mutes, doesn't unpublish) and stops
   * the hardware, turning off the mic light. After this `micActivated`
   * goes back to false; activating again requests the mic again
   * (already-granted permission doesn't prompt the browser again). */
  leaveMic: () => Promise<void>;
}

export interface MicrophoneActivationOptions {
  /** Publishes the track already muted, so joining muted never leaks a short
   * burst of audio while the UI catches up. */
  muted?: boolean;
}

export type MicrophoneActivationResult =
  | { ok: true; muted: boolean }
  | { ok: false; error: string; permissionDenied: boolean };

const CONNECT_TIMEOUT_MS = 15000;

/** Waits for the Room to connect, if it isn't yet — activateMic runs right
 * after joinVoiceChannel triggers the Room's connect() (see
 * RoomProvider.tsx), so at that instant the Room is likely still
 * 'connecting', not 'connected' yet. Without this, that race would make
 * activation fail almost every time. */
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

/**
 * "Native" Discord-style mic: not something you turn on/off, it's
 * activated once per session (on first joining a voice channel) and after
 * that only muted/unmuted — the hardware/getUserMedia stays alive the
 * whole time, no new permission prompt. The caller chooses whether it is
 * published already muted (the pre-call default) or ready to talk.
 * "Activated" and "muted" don't live in any state here or in the reducer —
 * they're read directly from LiveKit (useParticipantMedia), the same source
 * of truth used for remote participants.
 */
export function useMicrophone(room: Room, dispatch: Dispatch<RoomAction>): MicrophoneApi {
  // Dedupes parallel attempts (double click / retry while the permission
  // prompt is still open) and lets every caller receive the same result.
  const activatingRef = useRef<Promise<MicrophoneActivationResult> | null>(null);

  const activateMic = useCallback(async (options: MicrophoneActivationOptions = {}): Promise<MicrophoneActivationResult> => {
    if (activatingRef.current) return activatingRef.current;
    const existing = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (existing) {
      if (existing.isMuted !== !!options.muted) {
        await room.localParticipant.setMicrophoneEnabled(!options.muted);
      }
      return { ok: true, muted: !!options.muted };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const error = 'Seu navegador nao suporta acesso ao microfone. Voce ainda pode entrar somente para ouvir.';
      dispatch({ type: 'SET_SHARE_ERROR', message: error });
      return { ok: false, error, permissionDenied: false };
    }

    const attempt = (async (): Promise<MicrophoneActivationResult> => {
      let localTrack: Awaited<ReturnType<typeof createLocalAudioTrack>> | null = null;
      try {
        await waitForConnection(room);
        const deviceId = room.getActiveDevice('audioinput');
        localTrack = await createLocalAudioTrack(deviceId ? { deviceId } : undefined);
        // Muting BEFORE publish is important: setMicrophoneEnabled(true)
        // followed by mute can transmit a brief audible burst.
        if (options.muted) await localTrack.mute();
        await room.localParticipant.publishTrack(localTrack, { source: Track.Source.Microphone });
        dispatch({ type: 'SET_SHARE_ERROR', message: null });
        return { ok: true, muted: !!options.muted };
      } catch (err) {
        localTrack?.stop();
        let error: string;
        let permissionDenied = false;
        if (err instanceof Error && err.message === 'timeout') {
          error = 'Nao foi possivel conectar ao servidor de video. Verifique sua conexao e tente de novo.';
        } else {
          const name = (err as DOMException)?.name;
          permissionDenied = name === 'NotAllowedError' || name === 'SecurityError';
          if (permissionDenied) {
            error = 'Acesso ao microfone negado. Libere a permissao do site para falar; voce pode continuar somente ouvindo.';
          } else if (name === 'NotFoundError') {
            error = 'Nenhum microfone foi encontrado. Voce pode continuar somente ouvindo.';
          } else if (name === 'NotReadableError') {
            error = 'O microfone esta sendo usado por outro aplicativo. Feche-o ou continue somente ouvindo.';
          } else if (name === 'AbortError') {
            error = 'A ativacao do microfone foi cancelada. Voce pode continuar somente ouvindo.';
          } else {
            error = `Nao foi possivel acessar o microfone: ${(err as Error)?.message || 'erro desconhecido'}`;
          }
        }
        dispatch({ type: 'SET_SHARE_ERROR', message: error });
        return { ok: false, error, permissionDenied };
      } finally {
        activatingRef.current = null;
      }
    })();
    activatingRef.current = attempt;
    return attempt;
  }, [dispatch, room]);

  const toggleMicMuted = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    // no publication yet (mic never activated) means there's nothing to
    // mute/unmute here. Device capture belongs exclusively to activateMic;
    // a mute control must never request permission or publish by accident.
    if (!pub) return;
    // reads pub.isMuted BEFORE the await — once it resolves, the
    // publication already reflects the NEW state, and the sound needs to
    // announce the change that just happened (isMuted==true before = now
    // unmuted).
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
