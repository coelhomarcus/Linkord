import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatReplyRef, ClientMessage, ServerMessage } from '@/shared/types/protocol';

export type OutboxState = 'sending' | 'unknown' | 'failed';

export interface OutboxEntry {
  clientMessageId: string;
  conversationId: string;
  text: string;
  replyTo?: ChatReplyRef;
  createdAt: number;
  state: OutboxState;
  error?: string;
}

// No answer in this long and the send is "unknown": it may or may not have
// been stored. Resending with the same key is safe (the server is idempotent
// per key), so that's what happens, a few times, before asking the user.
const RESULT_TIMEOUT_MS = 10_000;
const MAX_AUTO_ATTEMPTS = 3;

interface Tracking {
  entry: OutboxEntry;
  replyToMsgId?: number;
  attempts: number;
  requestId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Messages the user sent that the server hasn't confirmed yet. One send in
 * flight per conversation, so your own messages are stored in the order you
 * wrote them even when an earlier one needs a retry. */
export function useMessageOutbox({ sendWs, onConfirmed }: {
  sendWs: (msg: ClientMessage) => boolean;
  onConfirmed: (message: ChatMessage) => void;
}) {
  // insertion order is submission order; the ref is the source of truth so
  // socket callbacks never act on a stale render's copy
  const trackingRef = useRef(new Map<string, Tracking>());
  const [pendingByConversation, setPendingByConversation] = useState<Map<string, OutboxEntry[]>>(new Map());
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => { onConfirmedRef.current = onConfirmed; }, [onConfirmed]);

  const publish = useCallback(() => {
    const next = new Map<string, OutboxEntry[]>();
    for (const { entry } of trackingRef.current.values()) {
      const list = next.get(entry.conversationId);
      if (list) list.push(entry); else next.set(entry.conversationId, [entry]);
    }
    setPendingByConversation(next);
  }, []);

  const update = useCallback((clientMessageId: string, patch: Partial<OutboxEntry>) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (tracked) tracked.entry = { ...tracked.entry, ...patch };
  }, []);

  const clearTimer = (tracked: Tracking) => {
    if (tracked.timer) clearTimeout(tracked.timer);
    tracked.timer = null;
  };

  const pumpRef = useRef<(conversationId: string) => void>(() => {});

  const transmit = useCallback((tracked: Tracking) => {
    const { entry } = tracked;
    tracked.requestId = crypto.randomUUID();
    tracked.attempts += 1;
    const sent = sendWs({
      t: 'chat', conversationId: entry.conversationId, text: entry.text,
      ...(tracked.replyToMsgId ? { replyTo: tracked.replyToMsgId } : {}),
      requestId: tracked.requestId, clientMessageId: entry.clientMessageId,
    });
    // offline: it waits for the next welcome instead of counting as a try
    if (!sent) { tracked.requestId = null; tracked.attempts -= 1; return; }
    tracked.timer = setTimeout(() => {
      tracked.timer = null;
      tracked.requestId = null;
      if (tracked.attempts >= MAX_AUTO_ATTEMPTS) {
        update(entry.clientMessageId, { state: 'failed', error: 'Não foi possível confirmar o envio.' });
      } else {
        update(entry.clientMessageId, { state: 'unknown' });
      }
      publish();
      pumpRef.current(entry.conversationId);
    }, RESULT_TIMEOUT_MS);
  }, [sendWs, update, publish]);

  const pump = useCallback((conversationId: string) => {
    let head: Tracking | null = null;
    for (const tracked of trackingRef.current.values()) {
      if (tracked.entry.conversationId !== conversationId || tracked.entry.state === 'failed') continue;
      if (tracked.requestId) return; // one in flight per conversation
      head ??= tracked;
    }
    if (head) transmit(head);
  }, [transmit]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);

  const enqueue = useCallback((conversationId: string, text: string, replyTo?: ChatReplyRef) => {
    const clientMessageId = crypto.randomUUID();
    trackingRef.current.set(clientMessageId, {
      entry: { clientMessageId, conversationId, text, replyTo, createdAt: Date.now(), state: 'sending' },
      replyToMsgId: replyTo?.msgId,
      attempts: 0,
      requestId: null,
      timer: null,
    });
    publish();
    pump(conversationId);
    return clientMessageId;
  }, [publish, pump]);

  const settle = useCallback((clientMessageId: string, message: ChatMessage | null, error?: string) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked) return;
    clearTimer(tracked);
    tracked.requestId = null;
    if (message) {
      trackingRef.current.delete(clientMessageId);
      onConfirmedRef.current(message);
    } else {
      update(clientMessageId, { state: 'failed', error });
    }
    publish();
    pump(tracked.entry.conversationId);
  }, [publish, pump, update]);

  const onChatSendResult = useCallback((m: Extract<ServerMessage, { t: 'chat-send-result' }>) => {
    const tracked = trackingRef.current.get(m.clientMessageId);
    // an answer to an attempt we already gave up on still settles the intent
    if (!tracked) return;
    if ('message' in m && m.message) settle(m.clientMessageId, m.message);
    else if ('error' in m && m.error) settle(m.clientMessageId, null, m.error.message);
  }, [settle]);

  /** The broadcast of one of our own sends can beat its result. */
  const onEcho = useCallback((message: ChatMessage) => {
    if (message.clientMessageId && trackingRef.current.has(message.clientMessageId)) settle(message.clientMessageId, message);
  }, [settle]);

  /** A (re)join: whatever was in flight on the old socket is resent with
   * its same key — the server answers a duplicate with the original. */
  const onReconnected = useCallback(() => {
    const conversations = new Set<string>();
    for (const tracked of trackingRef.current.values()) {
      clearTimer(tracked);
      tracked.requestId = null;
      conversations.add(tracked.entry.conversationId);
    }
    for (const id of conversations) pump(id);
  }, [pump]);

  const retry = useCallback((clientMessageId: string) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked || tracked.entry.state !== 'failed') return;
    tracked.attempts = 0;
    update(clientMessageId, { state: 'sending', error: undefined });
    publish();
    pump(tracked.entry.conversationId);
  }, [publish, pump, update]);

  const discard = useCallback((clientMessageId: string) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked) return;
    clearTimer(tracked);
    trackingRef.current.delete(clientMessageId);
    publish();
    pump(tracked.entry.conversationId);
  }, [publish, pump]);

  useEffect(() => () => {
    for (const tracked of trackingRef.current.values()) clearTimer(tracked);
  }, []);

  return { pendingByConversation, enqueue, onChatSendResult, onEcho, onReconnected, retry, discard };
}
