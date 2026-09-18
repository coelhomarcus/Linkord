import { participants, broadcastToKnownPeers } from '../presence/participants.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// short fixed list — avoids accepting arbitrary text as a "reaction"
export const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '👏', '🎉']);

function handleReaction(socket: AppSocket, msg: { emoji?: string }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const emoji = String(msg.emoji || '');
  if (!ALLOWED_REACTIONS.has(emoji)) return;
  // Etapa 7: this used to broadcast globally — a call reaction is exactly
  // the "chamadas alheias" (someone else's call) leak the etapa's own
  // criterion names, so it gets the same known-peers scoping as every
  // other presence event.
  broadcastToKnownPeers(p.userId, { t: 'reaction', id: p.id, emoji }, p.id);
}

export const handlers: HandlerTable = {
  reaction: handleReaction,
};
