import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config/env.js';
import type { Participant } from '../types.js';

/** Token de acesso a UMA sala do LiveKit (uma por canal de voz, ver
 * realtime/socket.ts#handleVoiceJoin — `roomName` vem de
 * `${LIVEKIT_ROOM_NAME}-${channelId}`), com a mesma identidade (p.id/p.name)
 * que o participante ja tem no Socket.IO — sem precisar de um mapa
 * id<->identity separado. */
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
