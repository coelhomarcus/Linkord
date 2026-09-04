import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant, Room, Track as LKTrack } from 'livekit-client';

import { useRoom } from '../../state/RoomContext';

export interface ParticipantMedia {
  screenTrack: LKTrack | null;
  screenAudioTrack: LKTrack | null;
  cameraTrack: LKTrack | null;
  micTrack: LKTrack | null;
  /** true once the mic was activated this session (published) — stays
   * true even muted, since muting only turns off audio, doesn't unpublish. */
  micActivated: boolean;
  micMuted: boolean;
}

const EMPTY_MEDIA: ParticipantMedia = {
  screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null,
  micActivated: false, micMuted: true,
};

/** Finds the Participant (local or remote) for an identity — same logic
 * used by useParticipantMedia and useCallTiles. */
export function getParticipant(room: Room, identity: string): Participant | undefined {
  return room.localParticipant.identity === identity ? room.localParticipant : room.getParticipantByIdentity(identity);
}

/** "Active" track — publication exists AND isn't muted. Muting video
 * (camera/screen) stops the hardware for real (unlike muting mic audio,
 * which just turns off sound) but does NOT unpublish: the publication/
 * Track keep existing forever after the first activation, with
 * isMuted=true. Without this filter, `!!cameraTrack` would stay true with
 * the camera off, leaving a black <video> attached to a dead track. */
export function activeTrack(participant: Participant, source: Track.Source): LKTrack | null {
  const pub = participant.getTrackPublication(source);
  return pub && !pub.isMuted ? (pub.track ?? null) : null;
}

function readMedia(room: Room, identity: string): ParticipantMedia {
  const participant = getParticipant(room, identity);
  if (!participant) return EMPTY_MEDIA;
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  return {
    screenTrack: activeTrack(participant, Track.Source.ScreenShare),
    screenAudioTrack: activeTrack(participant, Track.Source.ScreenShareAudio),
    cameraTrack: activeTrack(participant, Track.Source.Camera),
    // micTrack stays raw (not filtered by isMuted) on purpose — the audio
    // element in ParticipantAudioLayer needs to stay attached even muted,
    // ready to play the instant it unmutes; "muted" is expressed
    // separately via micMuted, not by hiding the track.
    micTrack: micPub?.track ?? null,
    micActivated: !!micPub,
    micMuted: micPub ? micPub.isMuted : true,
  };
}

const MEDIA_EVENTS = [
  // TrackPublished/Unpublished fire as soon as someone publishes/
  // unpublishes, even without me subscribing to the track — without them,
  // my own state would only "discover" a remote participant activated
  // their mic when some OTHER event triggered a refresh. TrackSubscribed/
  // Unsubscribed are here too, to know when the TRACK itself (not just the
  // publication) is available to play/attach.
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
];

/** Reads which tracks (screen/camera/mic) a participant (local or remote)
 * has published now, and whether the mic is muted — LiveKit is the only
 * source of truth, nothing kept separately in the reducer. One hook for
 * the whole participant (not one per Track.Source) because both the tile
 * list (useCallTiles) and Tile itself need screen and camera together to
 * decide how many rectangles this person occupies. */
export function useParticipantMedia(identity: string): ParticipantMedia {
  const { livekitRoom } = useRoom();
  const [media, setMedia] = useState<ParticipantMedia>(EMPTY_MEDIA);

  useEffect(() => {
    const refresh = () => setMedia(readMedia(livekitRoom, identity));
    refresh();
    for (const ev of MEDIA_EVENTS) livekitRoom.on(ev, refresh);
    return () => { for (const ev of MEDIA_EVENTS) livekitRoom.off(ev, refresh); };
  }, [livekitRoom, identity]);

  return media;
}

// RMS 0..1 — reasonable starting point, may need tuning after testing with
// a real mic (more sensitive = lower; less = higher).
const SPEAKING_THRESHOLD = 0.02;
// holds the border for a moment after dropping below the threshold, so it
// doesn't flicker on short pauses between words — only rising is instant.
const SPEAKING_RELEASE_MS = 250;

// one AudioContext for the whole app (not one per tile) — Web Audio only
// READS the track, doesn't "consume" it, so the same track feeds this and
// the <audio>/<video> already using it in parallel without conflict.
let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

/** Whether a participant is speaking right now. Used to come from
 * RoomEvent.ActiveSpeakersChanged — but that event isn't computed in the
 * browser, it's pushed periodically by the LiveKit SERVER via signaling,
 * causing a noticeable lag between starting to speak and the border
 * appearing (out of our control, especially on LiveKit Cloud). Detection
 * here runs 100% locally: analyzes the track's real audio via the Web
 * Audio API (AnalyserNode + requestAnimationFrame), ready in ~1 frame. */
export function useIsSpeaking(identity: string): boolean {
  const media = useParticipantMedia(identity);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const track = media.micTrack;
    if (!track || media.micMuted) { setIsSpeaking(false); return; }
    const mediaStreamTrack = track.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    const ctx = getAudioContext();
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let rafId: number;
    let lastAboveAt = 0;
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = performance.now();
      if (rms > SPEAKING_THRESHOLD) lastAboveAt = now;
      setIsSpeaking(now - lastAboveAt < SPEAKING_RELEASE_MS);
      rafId = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
    };
  }, [media.micTrack, media.micMuted]);

  return isSpeaking;
}

/** Attaches/detaches a LiveKit track to a video/audio element — native
 * WebRTC handles the rest (jitter, bitrate adaptation, etc), no manual
 * queue/buffer. */
export function useAttachTrack(track: LKTrack | null, elRef: RefObject<HTMLMediaElement | null>): void {
  useEffect(() => {
    const el = elRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, elRef]);
}
