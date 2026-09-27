import { formatDateHeading } from '@/shared/lib/formatChatTime';
import type { ChatMessage } from '@/shared/types/protocol';

const GROUP_GAP_MS = 5 * 60 * 1000;
export type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean };

export function buildTimelineItems(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  for (const message of messages) {
    const dateKey = new Date(message.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(message.ts) });
      lastDateKey = dateKey;
      lastMsg = null;
    }
    const showHeader = !lastMsg || lastMsg.id !== message.id || message.ts - lastMsg.ts > GROUP_GAP_MS;
    items.push({ type: 'message', key: String(message.msgId), message, showHeader });
    lastMsg = message;
  }
  return items;
}
