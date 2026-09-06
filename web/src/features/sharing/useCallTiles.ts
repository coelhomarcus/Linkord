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
    // participantIds includes everyone in chat/presence, but getParticipant
    // only resolves identities connected to THIS LiveKit room. Do not use a
    // mic publication as membership: listen-only users intentionally have
    // no mic track and still need an avatar tile.
    // !!track alone isn't enough: turning off camera/screen MUTES the
    // publication (doesn't unpublish), so the Track object keeps existing
    // forever after the first activation — activeTrack already filters that.
    const hasScreen = !!activeTrack(participant, Track.Source.ScreenShare);
    const hasCamera = !!activeTrack(participant, Track.Source.Camera);
    if (hasScreen) out.push({ key: tileKey(id, 'screen'), participantId: id, kind: 'screen' });
    // everyone in the call always has exactly ONE tile "of themselves"
    // (camera if they have it, otherwise avatar) — this is where the mic/
    // muted badge/speaking border live, never missing even when only
    // sharing a screen.
    const selfKind = hasCamera ? 'camera' : 'avatar';
    out.push({ key: tileKey(id, selfKind), participantId: id, kind: selfKind });
  }
  return out;
}

const CALL_TILE_EVENTS = [
  // Publication events update camera/screen tile kinds. Actual call
  // membership, including listen-only participants, is covered by the
  // ParticipantConnected/Disconnected events below.
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  // turning off camera/screen is a MUTE (doesn't unpublish, see
  // activeTrack above) — without listening for this, the camera tile
  // would never turn back into an avatar.
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
];

/** Builds the list of tiles to render in the call grid — one per ACTIVE
 * media source, not per participant (a person's screen and camera become
 * two separate rectangles, Discord-style). Doesn't listen for
 * ActiveSpeakersChanged on purpose: speaking doesn't change HOW MANY tiles
 * exist, it only needs visual highlighting (that's useIsSpeaking, inside
 * each Tile). */
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
