import { participants, broadcast } from './participants.js';
import type { AppSocket, HandlerTable } from '../types.js';

// short fixed list — avoids accepting arbitrary text as a "reaction"
export const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '👏', '🎉']);

function handleReaction(socket: AppSocket, msg: { emoji?: string }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const emoji = String(msg.emoji || '');
  if (!ALLOWED_REACTIONS.has(emoji)) return;
  broadcast({ t: 'reaction', id: p.id, emoji }, p.id);
}

export const handlers: HandlerTable = {
  reaction: handleReaction,
};
