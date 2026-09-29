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

  it('sends with a key and requestId; confirmation clears the pending entry and delivers the message', () => {
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

  it('one at a time per conversation: the second only goes out after the first is confirmed', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'um'); result.current.enqueue('c', 'dois'); result.current.enqueue('outra', 'paralela'); });
    expect(sent.map((m) => m.text)).toEqual(['um', 'paralela']);

    act(() => result.current.onChatSendResult(ok(sent[0]!)));
    expect(sent.map((m) => m.text)).toEqual(['um', 'paralela', 'dois']);
  });

  it('no response: stays "confirming" and resends with the SAME key; fails after 3 attempts', () => {
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

  it('a delayed response from an earlier attempt still confirms the intent', () => {
    const { result, sent, onConfirmed } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => { vi.advanceTimersByTime(10_000); });
    act(() => result.current.onChatSendResult(ok(sent[0]!)));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
  });

  it('server refusal becomes a failure with the reason; "retry" resends with the same key', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'rate_limited', message: 'Devagar.' } }));
    const entry = result.current.pendingByConversation.get('c')![0]!;
    expect(entry).toMatchObject({ state: 'failed', error: 'Devagar.' });

    act(() => result.current.retry(entry.clientMessageId));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.clientMessageId).toBe(entry.clientMessageId);
  });

  it('one failure does not block the conversation\'s following messages', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'um'); result.current.enqueue('c', 'dois'); });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'x', message: 'x' } }));
    expect(sent.map((m) => m.text)).toEqual(['um', 'dois']);
  });

  it('offline: the message waits and goes out on its own upon reconnection', () => {
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

  it('reconnection resends whatever was in flight with the same key', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onReconnected());
    expect(sent).toHaveLength(2);
    expect(sent[1]!.clientMessageId).toBe(sent[0]!.clientMessageId);
  });

  it('the broadcast of your own message can arrive before the result and already confirms it', () => {
    const { result, sent, onConfirmed } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onEcho(stored(sent[0]!.clientMessageId!)));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
    act(() => result.current.onChatSendResult(ok(sent[0]!)));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('discarding removes the pending entry', () => {
    const { result, sent } = setup();
    act(() => { result.current.enqueue('c', 'oi'); });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'x', message: 'x' } }));
    act(() => result.current.discard(sent[0]!.clientMessageId!));
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
  });
});

describe('useMessageOutbox — batches with attachments', () => {
  type Stage = NonNullable<Parameters<typeof useMessageOutbox>[0]['stageFile']>;
  function setupBatch() {
    const sent: ChatSend[] = [];
    const sendWs = vi.fn((msg: ClientMessage) => { sent.push(msg as ChatSend); return true; });
    const calls: { name: string; resolve: (id: string) => void; reject: (err: unknown) => void; signal?: AbortSignal }[] = [];
    const stageFile = vi.fn<Stage>(({ file, signal }) => new Promise((resolve, reject) => {
      calls.push({ name: file.name, signal, resolve: (id) => resolve({ id, name: file.name, mime: file.type, size: file.size }), reject });
    }));
    const discardStaged = vi.fn();
    const compress = vi.fn(async (file: File) => file);
    const hook = renderHook(() => useMessageOutbox({ sendWs, onConfirmed: vi.fn(), stageFile, discardStaged, compress }));
    return { ...hook, sent, calls, stageFile, discardStaged, compress };
  }
  const file = (name: string, type = 'application/pdf') => ({ file: new File(['x'], name, { type }), compress: false });
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the message only goes out once all files are ready, with ids in the chosen order', async () => {
    const { result, sent, calls } = setupBatch();
    act(() => { result.current.enqueue('c', 'legenda', undefined, [file('a.pdf'), file('b.pdf')]); });
    await flush();
    expect(result.current.pendingByConversation.get('c')?.[0]?.state).toBe('uploading');
    expect(calls.map((c) => c.name)).toEqual(['a.pdf', 'b.pdf']);

    // finishing out of order doesn't change the order sent
    calls[1]!.resolve('b'.repeat(32));
    await flush();
    expect(sent).toHaveLength(0);
    calls[0]!.resolve('a'.repeat(32));
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ text: 'legenda', attachmentIds: ['a'.repeat(32), 'b'.repeat(32)] });
  });

  it('at most two files upload at the same time', async () => {
    const { result, calls } = setupBatch();
    act(() => { result.current.enqueue('c', '', undefined, [file('1.pdf'), file('2.pdf'), file('3.pdf')]); });
    await flush();
    expect(calls).toHaveLength(2);
    calls[0]!.resolve('1'.repeat(32));
    await flush();
    expect(calls.map((c) => c.name)).toEqual(['1.pdf', '2.pdf', '3.pdf']);
  });

  it('one file fails: "retry" resends only it and then posts the whole batch', async () => {
    const { result, sent, calls } = setupBatch();
    act(() => { result.current.enqueue('c', '', undefined, [file('a.pdf'), file('b.pdf')]); });
    await flush();
    calls[0]!.resolve('a'.repeat(32));
    calls[1]!.reject(new Error('rede'));
    await flush();
    const entry = result.current.pendingByConversation.get('c')![0]!;
    expect(entry).toMatchObject({ state: 'failed', error: 'Um anexo não foi enviado.' });
    expect(entry.attachments!.map((a) => a.failed)).toEqual([false, true]);

    act(() => result.current.retry(entry.clientMessageId));
    await flush();
    expect(calls.map((c) => c.name)).toEqual(['a.pdf', 'b.pdf', 'b.pdf']);
    calls[2]!.resolve('c'.repeat(32));
    await flush();
    expect(sent[0]!.attachmentIds).toEqual(['a'.repeat(32), 'c'.repeat(32)]);
  });

  it('text typed after a batch mid-upload waits for the batch, to keep the order', async () => {
    const { result, sent, calls } = setupBatch();
    act(() => { result.current.enqueue('c', 'lote', undefined, [file('a.pdf')]); result.current.enqueue('c', 'depois'); });
    await flush();
    expect(sent).toHaveLength(0);
    calls[0]!.resolve('a'.repeat(32));
    await flush();
    expect(sent.map((m) => m.text)).toEqual(['lote']);
  });

  it('attachments expired on the server: the retry re-uploads the files again from memory', async () => {
    const { result, sent, calls } = setupBatch();
    act(() => { result.current.enqueue('c', '', undefined, [file('a.pdf')]); });
    await flush();
    calls[0]!.resolve('a'.repeat(32));
    await flush();
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: sent[0]!.requestId!, clientMessageId: sent[0]!.clientMessageId!, error: { code: 'attachments_unavailable', message: 'Expirou.' } }));
    act(() => result.current.retry(sent[0]!.clientMessageId!));
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('discarding mid-upload cancels the sends and erases what was already prepared', async () => {
    const { result, calls, discardStaged } = setupBatch();
    let id = '';
    act(() => { id = result.current.enqueue('c', '', undefined, [file('a.pdf'), file('b.pdf')]); });
    await flush();
    calls[0]!.resolve('a'.repeat(32));
    await flush();
    act(() => result.current.discard(id));
    expect(calls[1]!.signal?.aborted).toBe(true);
    expect(discardStaged).toHaveBeenCalledWith('a'.repeat(32));
    expect(result.current.pendingByConversation.get('c')).toBeUndefined();
  });

  it('with compression on, only images go through the compressor', async () => {
    const { result, compress } = setupBatch();
    act(() => { result.current.enqueue('c', '', undefined, [{ file: new File(['x'], 'f.png', { type: 'image/png' }), compress: true }, { file: new File(['x'], 'd.pdf', { type: 'application/pdf' }), compress: true }]); });
    await flush();
    expect(compress).toHaveBeenCalledTimes(1);
  });
});
