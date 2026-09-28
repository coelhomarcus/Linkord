import type { ReactionEmoji } from '@/shared/types/protocol';

export const reactionKey = (msgId: number, emoji: ReactionEmoji) => `${msgId}\u0000${emoji}`;

/** The server's reactions with the viewer's unconfirmed intents laid on
 * top. Only the viewer's own id moves: reactions from other people keep
 * arriving and are never overwritten by a pending (or failed) intent. */
export function withPendingReactions(
  reactions: Partial<Record<ReactionEmoji, string[]>> | undefined,
  msgId: number,
  pending: Map<string, boolean>,
  myUserId: string | null,
): Partial<Record<ReactionEmoji, string[]>> {
  const out: Partial<Record<ReactionEmoji, string[]>> = { ...reactions };
  if (!myUserId || !pending.size) return out;
  for (const [key, present] of pending) {
    const [id, emoji] = key.split('\u0000') as [string, ReactionEmoji];
    if (Number(id) !== msgId) continue;
    const others = (out[emoji] ?? []).filter((userId) => userId !== myUserId);
    const next = present ? [...others, myUserId] : others;
    if (next.length) out[emoji] = next; else delete out[emoji];
  }
  return out;
}
