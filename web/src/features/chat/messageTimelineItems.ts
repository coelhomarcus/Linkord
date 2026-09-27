import { formatDateHeading } from '@/shared/lib/formatChatTime';
import type { ChatMessage } from '@/shared/types/protocol';
import type { OutboxEntry } from './useMessageOutbox';

const GROUP_GAP_MS = 5 * 60 * 1000;
export type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean; pending?: OutboxEntry };

/** Who the pending copies are drawn as — they have no server row yet. */
export interface PendingAuthor { userId: string | null; name: string; avatar: string }

// A correlated send keeps the same key from pending to stored, so the row
// is updated in place instead of remounting (and re-running its media).
function messageKey(message: ChatMessage): string {
  return message.clientMessageId ? `c:${message.clientMessageId}` : String(message.msgId);
}

export function buildTimelineItems(messages: ChatMessage[], pending: OutboxEntry[] = [], author?: PendingAuthor): TimelineItem[] {
  const stored = new Set(messages.flatMap((message) => (message.clientMessageId ? [message.clientMessageId] : [])));
  const rows: { message: ChatMessage; pending?: OutboxEntry }[] = messages.map((message) => ({ message }));
  pending.forEach((entry, index) => {
    // the stored copy can land a render before the outbox lets go of it
    if (stored.has(entry.clientMessageId)) return;
    rows.push({
      pending: entry,
      message: {
        msgId: -(index + 1),
        conversationId: entry.conversationId,
        id: author?.userId ?? null,
        name: author?.name ?? '',
        avatar: author?.avatar ?? '',
        text: entry.text,
        ts: entry.createdAt,
        replyTo: entry.replyTo,
        clientMessageId: entry.clientMessageId,
      },
    });
  });

  const items: TimelineItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  for (const { message, pending: entry } of rows) {
    const dateKey = new Date(message.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(message.ts) });
      lastDateKey = dateKey;
      lastMsg = null;
    }
    const showHeader = !lastMsg || lastMsg.id !== message.id || message.ts - lastMsg.ts > GROUP_GAP_MS;
    items.push({ type: 'message', key: messageKey(message), message, showHeader, ...(entry ? { pending: entry } : {}) });
    lastMsg = message;
  }
  return items;
}
