import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config/env.js';
import type { Participant } from '../types.js';

/** Access token for ONE LiveKit room (one per group call, see
 * realtime/socket.ts#handleCallJoin — `roomName` comes from
 * `${LIVEKIT_ROOM_NAME}-${conversationId}`), with the same identity (p.id/p.name)
 * the participant already has in Socket.IO — no separate id<->identity
 * map needed. */
export function createToken(p: Participant, roomName: string): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: p.id,
    name: p.name,
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return at.toJwt();
}

/** Force-disconnects a participant from a LiveKit room — unlike the self-
 * reported mic/camera/sharing flags (see types.ts#Participant), this
 * actually kills their connection at the SFU regardless of client
 * cooperation. They're free to rejoin immediately after; this removes them
 * from the room, it doesn't ban them (see RoomServiceClient's own doc
 * comment on removeParticipant). Constructed per call, not a module-level
 * singleton, same reasoning as createToken above — degrades the same way
 * on a self-hosted instance that never configured LiveKit at all. */
export function kickParticipant(roomName: string, identity: string): Promise<void> {
  const roomService = new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  return roomService.removeParticipant(roomName, identity).then(() => undefined);
}
