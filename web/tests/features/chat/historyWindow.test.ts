import { describe, expect, it } from 'vitest';
import { withNewerMessages, withOlderPage } from '@/features/chat/historyWindow';
import type { ChatMessage } from '@/shared/types/protocol';

const msgs = (...ids: number[]): ChatMessage[] => ids.map((msgId) => ({ msgId, conversationId: 'c', id: 'a', name: 'A', avatar: '', text: String(msgId), ts: msgId }));
const ids = (list: ChatMessage[]) => list.map((m) => m.msgId);

describe('historyWindow', () => {
  it('pagina antiga entra antes, sem duplicar', () => {
    const r = withOlderPage(msgs(3, 4), msgs(1, 2, 3));
    expect(ids(r.messages)).toEqual([1, 2, 3, 4]);
    expect(r.trimmedNewest).toBe(false);
  });

  it('pagina antiga alem do limite corta as mais novas (longe de quem le no topo)', () => {
    const r = withOlderPage(msgs(4, 5, 6), msgs(1, 2, 3), 4);
    expect(ids(r.messages)).toEqual([1, 2, 3, 4]);
    expect(r.trimmedNewest).toBe(true);
  });

  it('mensagens novas alem do limite cortam as mais antigas', () => {
    const r = withNewerMessages(msgs(1, 2, 3), msgs(3, 4, 5), 4);
    expect(ids(r.messages)).toEqual([2, 3, 4, 5]);
    expect(r.trimmedOldest).toBe(true);
  });
});
