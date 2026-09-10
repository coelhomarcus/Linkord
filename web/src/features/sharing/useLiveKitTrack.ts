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
  micActivated: boolean;
  micMuted: boolean;
}

const EMPTY_MEDIA: ParticipantMedia = {
  screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null,
  micActivated: false, micMuted: true,
};

export function getParticipant(room: Room, identity: string): Participant | undefined {
  return room.localParticipant.identity === identity ? room.localParticipant : room.getParticipantByIdentity(identity);
}

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
    micTrack: micPub?.track ?? null,
    micActivated: !!micPub,
    micMuted: micPub ? micPub.isMuted : true,
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

export function useAttachTrack(track: LKTrack | null, elRef: RefObject<HTMLMediaElement | null>): void {
  useEffect(() => {
    const el = elRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, elRef]);
}
