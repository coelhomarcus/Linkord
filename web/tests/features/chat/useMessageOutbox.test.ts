import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMessageOutbox } from '@/features/chat/useMessageOutbox';
import type { ChatMessage, ClientMessage } from '@/shared/types/protocol';

type ChatSend = Extract<ClientMessage, { t: 'chat' }>;

function setup(connected = { value: true }) {
  const sent: ChatSend[] = [];
  const sendWs = vi.fn((msg: ClientMessage) => {
    if (!connected.value) return false;
    sent.push(msg as ChatSend);
    return true;
  });
  const onConfirmed = vi.fn();
  const hook = renderHook(() => useMessageOutbox({ sendWs, onConfirmed }));
  return { ...hook, sent, onConfirmed, connected };
}

const stored = (clientMessageId: string, msgId = 1): ChatMessage => ({
  msgId, conversationId: 'c', id: 'me', name: 'Eu', avatar: '', text: 'oi', ts: 1, clientMessageId,
});
const ok = (req: ChatSend, msgId = 1) => ({ t: 'chat-send-result' as const, requestId: req.requestId!, clientMessageId: req.clientMessageId!, message: stored(req.clientMessageId!, msgId) });

describe('useMessageOutbox', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('envia com chave e requestId; a confirmacao tira a pendencia e entrega a mensagem', () => {
    const { result, sent, onConfirmed } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'chat', conversationId: 'c', text: 'oi' });
    expect(sent[0]!.clientMessageId).toBeTruthy();
    expect(result.current.pendingByConversation.get('c')?.[0]?.state).toBe('sending');

    act(() => result.current.onChatSendResult(ok(sent[0]!)));

    expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: sent[0]!.clientMessageId }));
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
  });

  it('uma por vez por conversa: a segunda so sai depois da confirmacao da primeira', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'um'); result.current.enqueue('c', 'dois'); result.current.enqueue('outra', 'paralela'); });
    expect(sent.map((m) => m.text)).toEqual(['um', 'paralela']);

    act(() => result.current.onChatSendResult(ok(sent[0]!)));
    expect(sent.map((m) => m.text)).toEqual(['um', 'paralela', 'dois']);
  });

  it('sem resposta: fica "confirmando" e reenvia com a MESMA chave; depois de 3 tentativas, falha', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current.pendingByConversation.get('c')?.[0]?.state).toBe('unknown');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.clientMessageId).toBe(sent[0]!.clientMessageId);
    expect(sent[1]!.requestId).not.toBe(sent[0]!.requestId);

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(sent).toHaveLength(3);
    expect(result.current.pendingByConversation.get('c')?.[0]).toMatchObject({ state: 'failed', error: 'Não foi possível confirmar o envio.' });
  });

  it('resposta atrasada de uma tentativa anterior ainda confirma a intencao', () => {
    const { result, sent, onConfirmed } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => { vi.advanceTimersByTime(10_000); });
    act(() => result.current.onChatSendResult(ok(sent[0]!)));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
  });

  it('recusa do servidor vira falha com o motivo; "tentar de novo" reenvia a mesma chave', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'rate_limited', message: 'Devagar.' } }));
    const entry = result.current.pendingByConversation.get('c')![0]!;
    expect(entry).toMatchObject({ state: 'failed', error: 'Devagar.' });

    act(() => result.current.retry(entry.clientMessageId));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.clientMessageId).toBe(entry.clientMessageId);
  });

  it('uma falha nao trava as mensagens seguintes da conversa', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'um'); result.current.enqueue('c', 'dois'); });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'x', message: 'x' } }));
    expect(sent.map((m) => m.text)).toEqual(['um', 'dois']);
  });

  it('offline: a mensagem espera e sai sozinha na reconexao', () => {
    const connected = { value: false };
    const { result, sent } = setup(connected);
    act(() => { result.current.enqueue('c', 'sem rede'); });
    expect(sent).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.pendingByConversation.get('c')?.[0]?.state).toBe('sending');

    connected.value = true;
    act(() => result.current.onReconnected());
    expect(sent.map((m) => m.text)).toEqual(['sem rede']);
  });

  it('reconexao reenvia o que estava em voo com a mesma chave', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onReconnected());
    expect(sent).toHaveLength(2);
    expect(sent[1]!.clientMessageId).toBe(sent[0]!.clientMessageId);
  });

  it('o broadcast da propria mensagem pode chegar antes do resultado e ja confirma', () => {
    const { result, sent, onConfirmed } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onEcho(stored(sent[0]!.clientMessageId!)));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
    act(() => result.current.onChatSendResult(ok(sent[0]!)));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('descartar remove a pendencia', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'x', message: 'x' } }));
    act(() => result.current.discard(sent[0]!.clientMessageId!));
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
  });
});
