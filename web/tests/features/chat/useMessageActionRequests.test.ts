import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMessageActionRequests } from '@/features/chat/useMessageActionRequests';
import type { ClientMessage } from '@/shared/types/protocol';

describe('useMessageActionRequests', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(connected = true) {
    const sent: (ClientMessage & { requestId?: string })[] = [];
    const hook = renderHook(() => useMessageActionRequests((msg) => { if (connected) sent.push(msg as never); return connected; }));
    return { ...hook, sent };
  }

  it('resolve quando o servidor confirma', async () => {
    const { result, sent } = setup();
    let promise!: Promise<void>;
    act(() => { promise = result.current.request({ t: 'chat-delete', msgId: 1 }); });
    act(() => result.current.onChatActionResult({ t: 'chat-action-result', requestId: sent[0]!.requestId! }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejeita com o motivo do servidor', async () => {
    const { result, sent } = setup();
    let promise!: Promise<void>;
    act(() => { promise = result.current.request({ t: 'chat-edit', msgId: 1, text: 'x' }); });
    act(() => result.current.onChatActionResult({ t: 'chat-action-result', requestId: sent[0]!.requestId!, error: { code: 'forbidden', message: 'Não é sua.' } }));
    await expect(promise).rejects.toThrow('Não é sua.');
  });

  it('offline rejeita na hora; sem resposta rejeita depois do prazo', async () => {
    await expect(setup(false).result.current.request({ t: 'chat-delete', msgId: 1 })).rejects.toThrow('Sem conexão');
    const { result } = setup();
    let promise!: Promise<void>;
    act(() => { promise = result.current.request({ t: 'chat-delete', msgId: 1 }); });
    const assertion = expect(promise).rejects.toThrow('não respondeu');
    act(() => { vi.advanceTimersByTime(10_000); });
    await assertion;
  });
});
