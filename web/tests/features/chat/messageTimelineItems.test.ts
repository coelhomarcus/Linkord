import { describe, expect, it } from 'vitest';
import { buildTimelineItems } from '@/features/chat/messageTimelineItems';
import type { ChatMessage } from '@/shared/types/protocol';

const base = new Date(2026, 8, 20, 10, 0).getTime();
function msg(msgId: number, authorId: string, minutesAfter: number): ChatMessage {
  return { msgId, conversationId: 'c', id: authorId, name: authorId, avatar: '', text: `m${msgId}`, ts: base + minutesAfter * 60_000 };
}

describe('buildTimelineItems', () => {
  it('abre com um divisor de data e agrupa mensagens seguidas do mesmo autor', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0), msg(2, 'ana', 1), msg(3, 'bia', 2)]);
    expect(items.map((item) => item.type === 'date' ? 'date' : `${item.message.msgId}:${item.showHeader}`))
      .toEqual(['date', '1:true', '2:false', '3:true']);
  });

  it('mais de cinco minutos depois, o mesmo autor volta a mostrar o cabecalho', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0), msg(2, 'ana', 6)]);
    expect(items.filter((item) => item.type === 'message').map((item) => item.type === 'message' && item.showHeader)).toEqual([true, true]);
  });

  it('mudanca de dia cria novo divisor e quebra o agrupamento', () => {
    const items = buildTimelineItems([msg(1, 'ana', 0), msg(2, 'ana', 24 * 60)]);
    expect(items.map((item) => item.type)).toEqual(['date', 'message', 'date', 'message']);
    expect(items[3]!.type === 'message' && items[3]!.showHeader).toBe(true);
  });

  it('chaves estaveis: mensagem pelo msgId, data pelo dia', () => {
    const [date, message] = buildTimelineItems([msg(7, 'ana', 0)]);
    expect(message!.key).toBe('7');
    expect(date!.key).toBe(`date-${new Date(base).toDateString()}`);
  });
});
