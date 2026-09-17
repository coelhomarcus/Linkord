import { useEffect, useRef } from 'react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack } from './useLiveKitTrack';
import { loadCallVolume } from '../settings/useCallVolumePreference';
import { loadDevicePreference } from '../settings/useDevicePreference';

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
    // Same reasoning as the saved mic/camera device (useMicrophone.ts,
    // useCamera.ts): a freshly created <audio> element otherwise plays out
    // whatever the browser's default output is, ignoring the speaker saved
    // in Settings. setSinkId isn't in every browser (no Firefox support).
    const savedOutputId = loadDevicePreference('audiooutput');
    if (savedOutputId) {
      for (const el of [micEl, screenEl]) {
        if (el && 'setSinkId' in el) el.setSinkId(savedOutputId).catch(() => {});
      }
    }
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
