import { participants, removeParticipant } from '../presence/participants.js';
import { revokeCallAccess } from '../calls/callAccess.js';

/** Cuts every live connection an account has — sockets AND the media
 * connections behind any call it is in. Sessions are handled by the caller
 * (a suspension deletes the rows, a deletion cascades them). A connected
 * socket has no way to notice its session is gone until it reconnects, so
 * this is what makes a suspension or deletion take effect NOW. */
export function dropUserConnections(userId: string): void {
  for (const p of [...participants.values()]) {
    if (p.userId !== userId) continue;
    const socket = p.socket;
    // the media connection outlives the socket, so cut it at the SFU too
    if (p.callConversationId) void revokeCallAccess(userId, p.callConversationId);
    removeParticipant(p);
    try { socket?.disconnect(true); } catch { /* socket dying */ }
  }
}
