import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ClientMessage, ServerMessage } from '@/shared/types/protocol';

/** "Fulano está digitando..." indicator — entirely ephemeral, no persisted/
 * server-held state to reconcile on reconnect (unlike speaking/deafened).
 * `myUserIdRef` is read (not owned) here, just to filter out the server
 * ever echoing our own typing back to us. */
export function useTypingIndicator(sendWs: (msg: ClientMessage) => void, myUserIdRef: MutableRefObject<string | null>) {
  const [typingByConversation, setTypingByConversation] = useState<Map<string, Set<string>>>(new Map());
  // Per (conversationId, userId) auto-expiry timers — kept out of React
  // state (nothing renders off the timer itself), reset on every incoming
  // typing:true, cleared on typing:false. Covers a sender that disconnects
  // mid-typing without ever sending false.
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTypingEntry = useCallback((conversationId: string, userId: string) => {
    const key = `${conversationId}:${userId}`;
    const timer = typingTimersRef.current.get(key);
    if (timer) { clearTimeout(timer); typingTimersRef.current.delete(key); }
    setTypingByConversation((prev) => {
      const existing = prev.get(conversationId);
      if (!existing || !existing.has(userId)) return prev;
      const nextSet = new Set(existing);
      nextSet.delete(userId);
      const next = new Map(prev);
      if (nextSet.size) next.set(conversationId, nextSet); else next.delete(conversationId);
      return next;
    });
  }, []);

  // Timers are per-conversation-per-user, not tied to any single render —
  // only flush them on unmount, not on every clearTypingEntry identity change.
  useEffect(() => () => {
    typingTimersRef.current.forEach((timer) => clearTimeout(timer));
    typingTimersRef.current.clear();
  }, []);

  const sendTyping = useCallback((conversationId: string, value: boolean) => sendWs({ t: 'typing', conversationId, value }), [sendWs]);

  const onTyping = useCallback((m: Extract<ServerMessage, { t: 'typing' }>) => {
    if (m.userId === myUserIdRef.current) return; // never show yourself your own indicator
    const key = `${m.conversationId}:${m.userId}`;
    const existingTimer = typingTimersRef.current.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    if (m.value) {
      setTypingByConversation((prev) => {
        const existing = prev.get(m.conversationId);
        if (existing?.has(m.userId)) return prev; // already shown, just refreshing the expiry below
        const nextSet = new Set(existing).add(m.userId);
        return new Map(prev).set(m.conversationId, nextSet);
      });
      // Slightly longer than the composer's own 5s idle-timeout (see
      // MessageComposer.tsx) so a normal in-flight refresh always beats
      // this — only a genuinely lost typing:false (e.g. tab closed) ever
      // lets this fire.
      typingTimersRef.current.set(key, setTimeout(() => clearTypingEntry(m.conversationId, m.userId), 6000));
    } else {
      typingTimersRef.current.delete(key);
      clearTypingEntry(m.conversationId, m.userId);
    }
  }, [clearTypingEntry, myUserIdRef]);

  return { typingByConversation, sendTyping, clearTypingEntry, onTyping };
}
