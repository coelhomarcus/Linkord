import { AccessToken } from 'livekit-server-sdk';
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
