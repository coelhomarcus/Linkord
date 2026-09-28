import type { ChatMessage } from '@/shared/types/protocol';

// How many messages a conversation keeps loaded. Past this the side far
// from where the user is reading is dropped (and can be fetched again), so
// scrolling through a long history doesn't grow memory without bound.
export const MAX_WINDOW = 500;

export interface WindowUpdate {
  messages: ChatMessage[];
  /** set when this update dropped messages from that end */
  trimmedOldest: boolean;
  trimmedNewest: boolean;
}

function dedupe(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const ids = new Set(existing.map((msg) => msg.msgId));
  return incoming.filter((msg) => !ids.has(msg.msgId));
}

/** An older page arrived: the reader is at the top, so newer messages go. */
export function withOlderPage(existing: ChatMessage[], page: ChatMessage[], max = MAX_WINDOW): WindowUpdate {
  const next = [...dedupe(existing, page), ...existing];
  if (next.length <= max) return { messages: next, trimmedOldest: false, trimmedNewest: false };
  return { messages: next.slice(0, max), trimmedOldest: false, trimmedNewest: true };
}

/** A newer page (or a live message at the present): the oldest go. */
export function withNewerMessages(existing: ChatMessage[], incoming: ChatMessage[], max = MAX_WINDOW): WindowUpdate {
  const next = [...existing, ...dedupe(existing, incoming)];
  if (next.length <= max) return { messages: next, trimmedOldest: false, trimmedNewest: false };
  return { messages: next.slice(next.length - max), trimmedOldest: true, trimmedNewest: false };
}
