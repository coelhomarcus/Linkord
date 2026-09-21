import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../../config/env.js';
import type { Participant } from '../../types.js';

export function roomNameFor(conversationId: string): string {
  return `${config.LIVEKIT_ROOM_NAME}-${conversationId}`;
}

/** Access token for ONE LiveKit room (one per call — group or 1:1, see
 * realtime/socket.ts#handleCallJoin — `roomName` comes from
 * `${LIVEKIT_ROOM_NAME}-${conversationId}`), with the same identity (p.id/p.name)
 * the participant already has in Socket.IO — no separate id<->identity
 * map needed. `metadata` carries the account id so a room's live participants
 * can be mapped back to an account even after their socket is gone (see
 * evictFromCall). */
export function createToken(p: Participant, roomName: string): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: p.id,
    name: p.name,
    metadata: p.userId,
    ttl: config.LIVEKIT_TOKEN_TTL_SECONDS,
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

function roomService(): RoomServiceClient {
  return new RoomServiceClient(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
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
  return roomService().removeParticipant(roomName, identity).then(() => undefined);
}

const EVICT_ATTEMPTS = 3;
const EVICT_BACKOFF_MS = 1000;

interface RoomApi {
  removeParticipant(room: string, identity: string): Promise<unknown>;
  listParticipants(room: string): Promise<{ identity: string; metadata?: string }[]>;
}

/** Identities to remove: the account's live connections in this call (known
 * from the socket layer) plus anything the SFU itself lists for that account
 * — a tab that lost signaling can still be connected media-wise. */
export async function findIdentitiesToEvict(
  api: Pick<RoomApi, 'listParticipants'>, roomName: string, userId: string, known: string[],
): Promise<string[]> {
  const identities = new Set(known);
  try {
    for (const live of await api.listParticipants(roomName)) {
      if (live.metadata === userId) identities.add(live.identity);
    }
  } catch {
    // an empty/nonexistent room or an unreachable SFU — the known identities still get tried
  }
  return [...identities];
}

/** Removes every connection an account has in one conversation's call. Runs
 * AFTER the database change that revoked their membership and never undoes
 * it: a failure here is logged and retried a few times, not surfaced as a
 * failed removal (docs/plano-rede-social.md §7.4). Fire-and-forget by design;
 * resolves once attempts are exhausted or everything was removed. */
export async function evictFromCall(
  userId: string, conversationId: string, knownIdentities: string[],
  api: RoomApi = roomService(), sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY) return;
  const roomName = roomNameFor(conversationId);
  let pending = await findIdentitiesToEvict(api, roomName, userId, knownIdentities);
  for (let attempt = 1; attempt <= EVICT_ATTEMPTS && pending.length > 0; attempt++) {
    const failed: string[] = [];
    for (const identity of pending) {
      try {
        await api.removeParticipant(roomName, identity);
      } catch (err) {
        // "not found" just means they were already gone
        if (!/not.?found|does not exist/i.test(err instanceof Error ? err.message : String(err))) failed.push(identity);
      }
    }
    pending = failed;
    if (pending.length > 0 && attempt < EVICT_ATTEMPTS) await sleep(EVICT_BACKOFF_MS * attempt);
  }
  if (pending.length > 0) {
    console.warn(`[livekit] could not evict ${pending.length} connection(s) of ${userId} from ${conversationId} after ${EVICT_ATTEMPTS} attempts`);
  }
}
