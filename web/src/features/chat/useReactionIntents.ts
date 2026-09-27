import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ReactionEmoji } from '@/shared/types/protocol';
import { reactionKey } from './reactionState';

type ReactRequest = (msg: Extract<ClientMessage, { t: 'chat-react' }>) => Promise<void>;

/** The viewer's reactions as intents: shown at once, sent as a desired
 * state, one request per message+emoji at a time. Clicks while one is in
 * flight only update the intent, so rapid clicks converge on the last one
 * instead of racing each other. A failure drops the intent (the server's
 * copy shows again) and reports why. */
export function useReactionIntents({ request, onError }: { request: ReactRequest; onError: (msgId: number, message: string) => void }) {
  const [pendingReactions, setPendingReactions] = useState<Map<string, boolean>>(new Map());
  const desiredRef = useRef(new Map<string, boolean>());
  const inFlightRef = useRef(new Set<string>());

  const publish = useCallback(() => setPendingReactions(new Map(desiredRef.current)), []);
  const runRef = useRef<(msgId: number, emoji: ReactionEmoji) => void>(() => {});

  const run = useCallback((msgId: number, emoji: ReactionEmoji) => {
    const key = reactionKey(msgId, emoji);
    const present = desiredRef.current.get(key);
    if (present === undefined) return;
    inFlightRef.current.add(key);
    request({ t: 'chat-react', msgId, emoji, present }).then(() => {
      inFlightRef.current.delete(key);
      // changed its mind while this was in flight: send the latest
      if (desiredRef.current.get(key) !== present) { runRef.current(msgId, emoji); return; }
      desiredRef.current.delete(key);
      publish();
    }, (err: unknown) => {
      inFlightRef.current.delete(key);
      desiredRef.current.delete(key);
      publish();
      onError(msgId, err instanceof Error ? err.message : 'erro desconhecido');
    });
  }, [request, onError, publish]);
  useEffect(() => { runRef.current = run; }, [run]);

  /** `mineOnServer`: whether the server's copy has the viewer's reaction. */
  const react = useCallback((msgId: number, emoji: ReactionEmoji, mineOnServer: boolean) => {
    const key = reactionKey(msgId, emoji);
    const current = desiredRef.current.get(key) ?? mineOnServer;
    desiredRef.current.set(key, !current);
    publish();
    if (!inFlightRef.current.has(key)) run(msgId, emoji);
  }, [publish, run]);

  return { pendingReactions, react };
}
