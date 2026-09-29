import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { ConnectionQuality, RoomEvent, Track } from 'livekit-client';
import type { Participant, Room, Track as LKTrack } from 'livekit-client';

import { useRoom } from '../../state/RoomContext';

export interface ParticipantMedia {
  screenTrack: LKTrack | null;
  screenAudioTrack: LKTrack | null;
  cameraTrack: LKTrack | null;
  micTrack: LKTrack | null;
  micActivated: boolean;
  micMuted: boolean;
  /** The screen-share publication exists and still has a track, but it's
   * muted — the owner paused their own preview (see useScreenShare's
   * pauseSharePreview), not "no share"/"still loading". */
  screenPaused: boolean;
}

const EMPTY_MEDIA: ParticipantMedia = {
  screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null,
  micActivated: false, micMuted: true, screenPaused: false,
};

export function getParticipant(room: Room, identity: string): Participant | undefined {
  return room.localParticipant.identity === identity ? room.localParticipant : room.getParticipantByIdentity(identity);
}

export function activeTrack(participant: Participant, source: Track.Source): LKTrack | null {
  const pub = participant.getTrackPublication(source);
  return pub && !pub.isMuted ? (pub.track ?? null) : null;
}

/** True while a publication exists and isn't muted, but its track hasn't
 * attached yet — e.g. right after a remote participant connects, before
 * subscription finishes. Distinct from "no publication" (camera/share
 * genuinely off) and from "muted" — both of those also return null from
 * `activeTrack`, but only this one means "it's coming, just not here yet". */
export function isTrackPending(participant: Participant, source: Track.Source): boolean {
  const pub = participant.getTrackPublication(source);
  return !!pub && !pub.isMuted && !pub.track;
}

/** True when a screen-share publication exists, still has a track, but is
 * muted — i.e. deliberately paused (see useScreenShare's pauseSharePreview),
 * distinct from "no share" (no publication) and "loading" (no track yet). */
export function isScreenPaused(participant: Participant): boolean {
  const pub = participant.getTrackPublication(Track.Source.ScreenShare);
  return !!pub && pub.isMuted && !!pub.track;
}

function readMedia(room: Room, identity: string): ParticipantMedia {
  const participant = getParticipant(room, identity);
  if (!participant) return EMPTY_MEDIA;
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  return {
    screenTrack: activeTrack(participant, Track.Source.ScreenShare),
    screenAudioTrack: activeTrack(participant, Track.Source.ScreenShareAudio),
    cameraTrack: activeTrack(participant, Track.Source.Camera),
    micTrack: micPub?.track ?? null,
    micActivated: !!micPub,
    micMuted: micPub ? micPub.isMuted : true,
    screenPaused: isScreenPaused(participant),
  };
}

const MEDIA_EVENTS = [
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

interface StoreEntry<T> {
  value: T;
  listeners: Set<() => void>;
  teardown: () => void;
}

/** One shared LiveKit subscription per (room, identity), reused by every
 * caller watching that identity — instead of each `useParticipantMedia`/
 * `useConnectionQuality` instance registering its own room listeners. A
 * participant commonly has 2+ simultaneous watchers today (a camera tile
 * AND a screen tile for the same person, `useIsSpeaking` calling
 * `useParticipantMedia` again internally, TileMenu re-reading it while
 * open) — this is the "reduzir duplicação por participante" from the
 * calls redesign plan §11.2, not a hypothetical future need. */
function createPerIdentityStore<T>(compute: (room: Room, identity: string) => T, events: RoomEvent[]) {
  const byRoom = new WeakMap<Room, Map<string, StoreEntry<T>>>();

  function subscribe(room: Room, identity: string, callback: () => void): () => void {
    let byIdentity = byRoom.get(room);
    if (!byIdentity) { byIdentity = new Map(); byRoom.set(room, byIdentity); }
    let entry = byIdentity.get(identity);
    if (!entry) {
      const listeners = new Set<() => void>();
      const refresh = () => {
        const next = compute(room, identity);
        if (Object.is(next, entry!.value)) return;
        entry!.value = next;
        for (const l of listeners) l();
      };
      for (const ev of events) room.on(ev, refresh);
      entry = { value: compute(room, identity), listeners, teardown: () => { for (const ev of events) room.off(ev, refresh); } };
      byIdentity.set(identity, entry);
    }
    entry.listeners.add(callback);
    return () => {
      entry!.listeners.delete(callback);
      if (entry!.listeners.size === 0) {
        entry!.teardown();
        byIdentity!.delete(identity);
      }
    };
  }

  // Never creates the room-level subscription itself (that's `subscribe`'s
  // job alone) — a pure read, falling back to a one-off compute when no
  // subscriber has registered yet.
  function getSnapshot(room: Room, identity: string): T {
    return byRoom.get(room)?.get(identity)?.value ?? compute(room, identity);
  }

  return { subscribe, getSnapshot };
}

const mediaStore = createPerIdentityStore(readMedia, MEDIA_EVENTS);

export function useParticipantMedia(identity: string): ParticipantMedia {
  const { livekitRoom } = useRoom();
  // Both callbacks MUST stay referentially stable across renders (not fresh
  // closures every time) — otherwise React treats "subscribe changed" as a
  // reason to unsubscribe/resubscribe on every render, and since `readMedia`
  // allocates a new object each call, that churn looks like "the snapshot
  // changed" forever: an infinite re-render loop, not just wasted work.
  const subscribe = useCallback((callback: () => void) => mediaStore.subscribe(livekitRoom, identity, callback), [livekitRoom, identity]);
  const getSnapshot = useCallback(() => mediaStore.getSnapshot(livekitRoom, identity), [livekitRoom, identity]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_RELEASE_MS = 250;

let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

export function useTrackSpeaking(track: LKTrack | null, muted: boolean): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!track || muted) { setIsSpeaking(false); return; }
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
  }, [track, muted]);

  return isSpeaking;
}

export function useIsSpeaking(identity: string): boolean {
  const media = useParticipantMedia(identity);
  return useTrackSpeaking(media.micTrack, media.micMuted);
}

function readConnectionQuality(room: Room, identity: string): ConnectionQuality {
  return getParticipant(room, identity)?.connectionQuality ?? ConnectionQuality.Unknown;
}

const qualityStore = createPerIdentityStore(readConnectionQuality, [RoomEvent.ConnectionQualityChanged]);

/** Tracks a participant's connection quality straight from the LiveKit room
 * — everyone in a call is already in the same LiveKit room, so this needs no
 * relay through the app's own WebSocket (unlike mic/camera/speaking state,
 * which the server mirrors for participants who haven't joined LiveKit yet).
 * `ConnectionQualityChanged` fires for ANY participant, not scoped to one —
 * shared per identity like `useParticipantMedia`, so a person's camera AND
 * screen tile (2 watchers, same identity) don't each register their own
 * room-wide listener for it. */
export function useConnectionQuality(identity: string): ConnectionQuality {
  const { livekitRoom } = useRoom();
  const subscribe = useCallback((callback: () => void) => qualityStore.subscribe(livekitRoom, identity, callback), [livekitRoom, identity]);
  const getSnapshot = useCallback(() => qualityStore.getSnapshot(livekitRoom, identity), [livekitRoom, identity]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useAttachTrack(track: LKTrack | null, elRef: RefObject<HTMLMediaElement | null>): void {
  useEffect(() => {
    const el = elRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, elRef]);
}

/** "Parar de assistir" a remote screen share: tells the server to stop
 * sending this viewer video/audio data for it (`RemoteTrackPublication.
 * setEnabled`), a real bandwidth saving — but it never touches the
 * publication itself, so the presenter keeps publishing and every other
 * viewer is unaffected (see the calls redesign plan §9.2: "'Parar de
 * assistir' não encerra a publicação remota"). Re-applies whenever the
 * publication (re)appears, so restarting a paused-for-me share stays off. */
export function useWatchScreenShare(room: Room, participantId: string, notWatching: boolean): void {
  useEffect(() => {
    function apply() {
      const participant = getParticipant(room, participantId);
      if (!participant) return;
      for (const source of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) {
        const pub = participant.getTrackPublication(source);
        if (pub && !pub.isLocal) (pub as unknown as { setEnabled: (enabled: boolean) => void }).setEnabled(!notWatching);
      }
    }
    apply();
    room.on(RoomEvent.TrackPublished, apply);
    room.on(RoomEvent.TrackSubscribed, apply);
    return () => {
      room.off(RoomEvent.TrackPublished, apply);
      room.off(RoomEvent.TrackSubscribed, apply);
    };
  }, [room, participantId, notWatching]);
}
