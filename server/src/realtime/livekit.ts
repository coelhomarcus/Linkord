import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config/env.js';
import type { Participant } from '../types.js';

/** Access token for ONE LiveKit room (one per voice channel, see
 * realtime/socket.ts#handleVoiceJoin — `roomName` comes from
 * `${LIVEKIT_ROOM_NAME}-${channelId}`), with the same identity (p.id/p.name)
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

export function voiceRoomName(channelId: string): string {
  return `${config.LIVEKIT_ROOM_NAME}-${channelId}`;
}

let roomService: RoomServiceClient | null = null;

function getRoomService(): RoomServiceClient | null {
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) return null;
  if (!roomService) roomService = new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  return roomService;
}

function isMissingResourceError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const code = (err as { code?: string } | null)?.code;
  return status === 404 || code === 'not_found';
}

/** Force-disconnects one media identity and revokes tokens issued up to now.
 * Closing Socket.IO alone does not stop a modified LiveKit client from
 * continuing to publish. */
export async function removeParticipant(roomName: string, identity: string): Promise<void> {
  const service = getRoomService();
  if (!service || !roomName || !identity) return;
  try {
    await service.removeParticipant(roomName, identity, {
      // One second ahead also covers a token minted in this same clock second
      // (the API invalidates tokens whose nbf is before this timestamp).
      revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1),
    });
  } catch (err) {
    if (isMissingResourceError(err)) return;
    throw err;
  }
}

/** Disconnects every media participant and removes the channel's LiveKit
 * room. Missing rooms are already in the desired state. */
export async function deleteVoiceRoom(channelId: string): Promise<void> {
  const service = getRoomService();
  if (!service) return;
  try {
    await service.deleteRoom(voiceRoomName(channelId));
  } catch (err) {
    if (isMissingResourceError(err)) return;
    throw err;
  }
}
