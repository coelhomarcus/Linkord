import { useEffect, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import { activeTrack, getParticipant } from './useLiveKitTrack';
import { tileKey } from './tileTypes';
import type { TileDescriptor } from './tileTypes';

function buildDescriptors(room: Room, participantIds: string[]): TileDescriptor[] {
  const out: TileDescriptor[] = [];
  for (const id of participantIds) {
    const participant = getParticipant(room, id);
    if (!participant) continue;
    if (!participant.getTrackPublication(Track.Source.Microphone)) continue;
    const hasScreen = !!activeTrack(participant, Track.Source.ScreenShare);
    const hasCamera = !!activeTrack(participant, Track.Source.Camera);
    if (hasScreen) out.push({ key: tileKey(id, 'screen'), participantId: id, kind: 'screen' });
    const selfKind = hasCamera ? 'camera' : 'avatar';
    out.push({ key: tileKey(id, selfKind), participantId: id, kind: selfKind });
  }
  return out;
}

const CALL_TILE_EVENTS = [
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

export function useCallTiles(participantIds: string[]): TileDescriptor[] {
  const { livekitRoom } = useRoom();
  const [descriptors, setDescriptors] = useState<TileDescriptor[]>([]);
  const idsKey = participantIds.join(',');

  useEffect(() => {
    const refresh = () => setDescriptors(buildDescriptors(livekitRoom, idsKey ? idsKey.split(',') : []));
    refresh();
    for (const ev of CALL_TILE_EVENTS) livekitRoom.on(ev, refresh);
    return () => { for (const ev of CALL_TILE_EVENTS) livekitRoom.off(ev, refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livekitRoom, idsKey]);

  return descriptors;
}
