import { useEffect, useRef } from 'react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack } from './useLiveKitTrack';
import { loadCallVolume } from '../settings/useCallVolumePreference';

/** Owns the <audio> elements (mic + screen audio) for ONE remote
 * participant — lives outside the visual Tiles on purpose: that person's
 * "self" tile switches kind (avatar↔camera) every time they toggle their
 * camera, and if <audio> lived inside the Tile, each switch would
 * unmount/remount the element. Here the component only remounts if the
 * PERSON leaves the room, never because of kind. `audioUnlocked`
 * (RoomProvider) is global — any user gesture unlocks autoplay for the
 * whole page, so there's no "per participant" here, just waiting for that
 * flag to flip true. Real volume (set explicitly below) is fully separate
 * from that — muted by a blocked autoplay isn't the same as low volume. */
function ParticipantAudio({ participantId }: { participantId: string }) {
  const { state, audioRegistry, audioUnlocked, deafened } = useRoom();
  const userId = state.participants.get(participantId)?.userId ?? null;
  const media = useParticipantMedia(participantId);
  const micRef = useRef<HTMLAudioElement | null>(null);
  const screenRef = useRef<HTMLAudioElement | null>(null);
  useAttachTrack(media.micTrack, micRef);
  useAttachTrack(media.screenAudioTrack, screenRef);

  useEffect(() => {
    for (const el of [micRef.current, screenRef.current]) {
      if (!el) continue;
      el.muted = !audioUnlocked || deafened;
      if (audioUnlocked && !deafened) el.play().catch(() => {});
    }
  }, [audioUnlocked, deafened, media.micTrack, media.screenAudioTrack]);

  useEffect(() => {
    const screenKey = `${participantId}:screen`;
    const micEl = micRef.current;
    const screenEl = screenRef.current;
    // real volume comes from the saved per-userId preference (default 100%
    // if never adjusted) — set explicitly here, not implicitly, since
    // "audio stuck at minimum" was exactly the confusion behind an earlier
    // bug (the blocked-autoplay mute was being read as volume; real volume
    // was never actually low). userId, not participantId, since that's
    // what survives reconnects/tabs — see useCallVolumePreference.ts.
    if (micEl) {
      micEl.volume = userId ? loadCallVolume(userId) : 1;
      audioRegistry.current.set(participantId, { element: micEl });
    }
    if (screenEl) {
      screenEl.volume = userId ? loadCallVolume(`${userId}:screen`) : 1;
      audioRegistry.current.set(screenKey, { element: screenEl });
    }
    return () => {
      audioRegistry.current.delete(participantId);
      audioRegistry.current.delete(screenKey);
    };
  }, [participantId, userId, audioRegistry]);

  return (
    <>
      <audio ref={micRef} autoPlay muted={!audioUnlocked || deafened} />
      <audio ref={screenRef} autoPlay muted={!audioUnlocked || deafened} />
    </>
  );
}

/** Mounts one <ParticipantAudio> per remote participant in the room (never
 * for myself — we never play our own audio back). Lives in the Shell
 * (App.tsx), outside the Call tab — needs to survive switching tabs, or
 * everyone's audio would stop. */
export function ParticipantAudioLayer({ participantIds }: { participantIds: string[] }) {
  const { state } = useRoom();
  return (
    <>
      {participantIds
        .filter((id) => id !== state.me.id)
        .map((id) => <ParticipantAudio key={id} participantId={id} />)}
    </>
  );
}
