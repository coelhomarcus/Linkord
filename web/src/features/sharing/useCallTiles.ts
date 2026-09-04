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
    // participantIds includes everyone in the ROOM (chat/presence), not
    // just who's in the call — without this filter, anyone who never
    // activated their mic (or already left the call for real, see
    // leaveMic) would show up as an avatar tile on stage, as if connected.
    // "In the call" = has a published mic, the same source of truth used
    // in App.tsx (inCall) and LeftSidebar (CallParticipantRow).
    if (!participant.getTrackPublication(Track.Source.Microphone)) continue;
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
  // Published/Unpublished fire as soon as someone joins/leaves the call
  // (the "inCall" filter above depends on this) — without them, this hook
  // would only "discover" someone joined/left by accident, whenever some
  // other event triggered a refresh (same root cause as a bug fixed
  // earlier in useLiveKitTrack.ts).
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
