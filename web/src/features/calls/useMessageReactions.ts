import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ClientMessage, ReactionEmoji, ServerMessage } from '@/shared/types/protocol';
import type { ReactionEvent } from '@/state/RoomContext';

const REACTION_DURATION_MS = 3000;

/** The floating emoji-burst overlay (Discord-style "send a reaction into
 * the call"), NOT the same thing as a per-message chat reaction
 * (chat-react/chat-reaction-updated) — that one lives in useChatMessages
 * since it mutates a message's own reactions map. This one is purely
 * ephemeral UI: nothing here is ever read back from the server. */
export function useMessageReactions(sendWs: (msg: ClientMessage) => void, myIdRef: MutableRefObject<string | null>) {
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const reactionKeyRef = useRef(0);

  const pushReaction = useCallback((id: string, emoji: ReactionEmoji) => {
    const key = reactionKeyRef.current++;
    const left = 12 + Math.random() * 76;
    setReactions((prev) => [...prev, { key, id, emoji, left }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), REACTION_DURATION_MS);
  }, []);

  const sendReaction = useCallback((emoji: ReactionEmoji) => {
    sendWs({ t: 'reaction', emoji });
    if (myIdRef.current) pushReaction(myIdRef.current, emoji);
  }, [pushReaction, sendWs, myIdRef]);

  const onReaction = useCallback((m: Extract<ServerMessage, { t: 'reaction' }>) => {
    pushReaction(m.id, m.emoji);
  }, [pushReaction]);

  return { reactions, sendReaction, onReaction };
}
