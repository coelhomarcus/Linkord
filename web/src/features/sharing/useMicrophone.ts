import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';

export interface MicrophoneApi {
  /** Requests permission and publishes the mic once per session, already
   * unmuted. Idempotent — safe to call again (e.g. retry after permission
   * denied, or the caller remounting). */
  activateMic: () => Promise<void>;
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
 * whole time, no new permission prompt. Starts unmuted (everyone joins
 * talking, no need to manually unmute). "Activated" and "muted" don't live
 * in any state here or in the reducer — they're read directly from
 * LiveKit (useParticipantMedia), the same source of truth used for remote
 * participants.
 */
export function useMicrophone(room: Room, dispatch: Dispatch<RoomAction>): MicrophoneApi {
  // guards only against calling setMicrophoneEnabled twice in parallel if
  // activateMic is called again before the first activation finishes — not
  // the "micActivated" the UI uses (that comes from LiveKit).
  const activatingRef = useRef(false);

  const activateMic = useCallback(async () => {
    if (activatingRef.current) return;
    if (room.localParticipant.getTrackPublication(Track.Source.Microphone)) return; // already activated
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador nao suporta acesso ao microfone.' });
      return;
    }

    activatingRef.current = true;
    try {
      await waitForConnection(room);
      await room.localParticipant.setMicrophoneEnabled(true); // already starts unmuted
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
    // no publication yet (mic never activated) means there's nothing to
    // mute/unmute here — without this guard, `pub?.isMuted ?? true` would
    // fall into the same setMicrophoneEnabled(true) activateMic uses,
    // actually joining the call just by clicking "unmute" outside of it.
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
