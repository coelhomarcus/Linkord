import { describe, expect, it } from 'vitest';
import { withNewerMessages, withOlderPage } from '@/features/chat/historyWindow';
import type { ChatMessage } from '@/shared/types/protocol';

const msgs = (...ids: number[]): ChatMessage[] => ids.map((msgId) => ({ msgId, conversationId: 'c', id: 'a', name: 'A', avatar: '', text: String(msgId), ts: msgId }));
const ids = (list: ChatMessage[]) => list.map((m) => m.msgId);

describe('historyWindow', () => {
  it('an older page goes in before, without duplicating', () => {
    const r = withOlderPage(msgs(3, 4), msgs(1, 2, 3));
    expect(ids(r.messages)).toEqual([1, 2, 3, 4]);
    expect(r.trimmedNewest).toBe(false);
  });

  it("an older page beyond the limit trims the newest ones (far from whoever's reading at the top)", () => {
    const r = withOlderPage(msgs(4, 5, 6), msgs(1, 2, 3), 4);
    expect(ids(r.messages)).toEqual([1, 2, 3, 4]);
    expect(r.trimmedNewest).toBe(true);
  });

  it('new messages beyond the limit trim the oldest ones', () => {
    const r = withNewerMessages(msgs(1, 2, 3), msgs(3, 4, 5), 4);
    expect(ids(r.messages)).toEqual([2, 3, 4, 5]);
    expect(r.trimmedOldest).toBe(true);
  });
});
