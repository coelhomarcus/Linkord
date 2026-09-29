import { describe, expect, it } from 'vitest';
import { buildTimelineItems } from '@/features/chat/messageTimelineItems';
import type { ChatMessage } from '@/shared/types/protocol';

const base = new Date(2026, 8, 20, 10, 0).getTime();
function msg(msgId: number, authorId: string, minutesAfter: number): ChatMessage {
  return { msgId, conversationId: 'c', id: authorId, name: authorId, avatar: '', text: `m${msgId}`, ts: base + minutesAfter * 60_000 };
}

describe('buildTimelineItems', () => {
  it('opens with a date divider and groups consecutive messages from the same author', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0), msg(2, 'ana', 1), msg(3, 'bia', 2)]);
    expect(items.map((item) => item.type === 'date' ? 'date' : `${item.message.msgId}:${item.showHeader}`))
      .toEqual(['date', '1:true', '2:false', '3:true']);
  });

  it('more than five minutes later, the same author shows the header again', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0), msg(2, 'ana', 6)]);
    expect(items.filter((item) => item.type === 'message').map((item) => item.type === 'message' && item.showHeader)).toEqual([true, true]);
  });

  it('a day change creates a new divider and breaks the grouping', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0), msg(2, 'ana', 24 * 60)]);
    expect(items.map((item) => item.type)).toEqual(['date', 'message', 'date', 'message']);
    expect(items[3]!.type === 'message' && items[3]!.showHeader).toBe(true);
  });

  it('stable keys: message by msgId, date by day', () => {
    const [date, message] = buildTimelineItems([msg(7, 'ana', 0)]);
    expect(message!.key).toBe('7');
    expect(date!.key).toBe(`date-${new Date(base).toDateString()}`);
  });
});

describe('buildTimelineItems — pending sends', () => {
  const pending = { clientMessageId: 'k1', conversationId: 'c', text: 'indo', createdAt: base + 60_000, state: 'sending' as const };
  const me = { userId: 'ana', name: 'Ana', avatar: '' };

  it('the pending one goes at the end, grouped with the previous message from the same author', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0)], [pending], me);
    const last = items[items.length - 1]!;
    expect(last.type === 'message' && last.pending?.clientMessageId).toBe('k1');
    expect(last.type === 'message' && last.showHeader).toBe(false);
  });

  it("the key stays the same before and after confirmation (the row doesn't remount)", () => {
    const before = buildTimelineItems([], [pending], me).at(-1)!;
    const confirmed = { ...msg(9, 'ana', 1), clientMessageId: 'k1' };
    const after = buildTimelineItems([confirmed], [pending], me);
    expect(after.filter((item) => item.type === 'message')).toHaveLength(1);
    expect(after.at(-1)!.key).toBe(before.key);
  });
});
