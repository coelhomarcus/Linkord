import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageTimeline } from '@/features/chat/MessageTimeline';

// jsdom has no layout: give the scroll container and each row a height, the
// way the virtualizer reads them (offsetHeight), and record scrollTo calls.
const VIEWPORT = 600;
const ROW = 40;
const scrolled: { el: Element; top: number }[] = [];
let originalOffsetHeight: PropertyDescriptor | undefined;
let originalScrollHeight: PropertyDescriptor | undefined;
let originalClientHeight: PropertyDescriptor | undefined;
const isRoot = (el: Element) => el.hasAttribute('data-scroll-root');

beforeEach(() => {
  scrolled.length = 0;
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  // the content's height is the virtual list's total size
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() { return isRoot(this) ? parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0 : 0; },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return isRoot(this) ? VIEWPORT : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return isRoot(this as HTMLElement) ? VIEWPORT : ROW; },
  });
  Element.prototype.scrollTo = vi.fn(function (this: Element, options?: ScrollToOptions | number) {
    const top = typeof options === 'object' ? options.top ?? 0 : 0;
    scrolled.push({ el: this, top });
    // what a browser does: move, then tell whoever listens
    Object.defineProperty(this, 'scrollTop', { configurable: true, writable: true, value: top });
    this.dispatchEvent(new Event('scroll'));
  }) as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  if (originalScrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', originalScrollHeight);
  if (originalClientHeight) Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
  vi.restoreAllMocks();
});

const message = (msgId: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  msgId, conversationId: 'conv-1', id: `u${msgId % 3}`, name: 'Alguém', avatar: '', text: `mensagem ${msgId}`, ts: Date.UTC(2026, 8, 1) + msgId * 600_000, ...over,
});

function renderTimeline(overrides: Partial<RoomContextValue>, surfaces = 1) {
  const value = createFakeRoomContextValue(overrides);
  return render(
    <RoomContext.Provider value={value}>
      {Array.from({ length: surfaces }, (_, i) => (
        <div key={i} data-surface={i}>
          <MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
        </div>
      ))}
    </RoomContext.Provider>,
  );
}

describe('MessageTimeline — virtualizacao', () => {
  it('com 1000 mensagens, so as visiveis (e uma folga) ficam no DOM', async () => {
    const messages = Array.from({ length: 1000 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(container.querySelectorAll('[data-msg-id]').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('[data-msg-id]').length).toBeLessThan(60);
  });

  it('abre no presente: a ultima mensagem esta montada', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]) });
    await waitFor(() => expect(container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    expect(container.querySelector('[data-msg-id="1"]')).toBeNull();
  });

  it('uma edicao aberta continua montada mesmo fora da tela', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => message(i + 1));
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', messages]]), editingMsgId: 1 });
    await waitFor(() => expect(container.querySelector('[data-msg-id="300"]')).not.toBeNull());
    expect(container.querySelector('[data-msg-id="1"]')).not.toBeNull();
  });

  it('no topo com historico anterior disponivel, pede a pagina anterior', async () => {
    const loadOlderMessages = vi.fn();
    renderTimeline({ messagesByConversation: new Map([['conv-1', [message(1), message(2)]]]), hasMoreByConversation: new Map([['conv-1', true]]), loadOlderMessages });
    await waitFor(() => expect(loadOlderMessages).toHaveBeenCalledWith('conv-1'));
  });

  it('janela antiga: no fim pede a pagina seguinte e mostra como voltar ao presente', async () => {
    const loadNewerMessages = vi.fn();
    const openConversation = vi.fn();
    renderTimeline({
      messagesByConversation: new Map([['conv-1', [message(1), message(2)]]]),
      hasMoreByConversation: new Map([['conv-1', false]]),
      hasMoreAfterByConversation: new Map([['conv-1', true]]),
      newerCountByConversation: new Map([['conv-1', 3]]),
      loadNewerMessages, openConversation,
    });
    await waitFor(() => expect(loadNewerMessages).toHaveBeenCalledWith('conv-1'));
    fireEvent.click(screen.getByRole('button', { name: /3 mensagens novas · voltar ao presente/ }));
    expect(openConversation).toHaveBeenCalledWith('conv-1');
  });
});

describe('MessageTimeline — salto para mensagem', () => {
  it('com a mesma conversa em duas superficies, o salto so rola a lista que o pediu', async () => {
    const original = message(1, { text: 'original' });
    const reply = message(2, { text: 'resposta', replyTo: { msgId: 1, authorId: 'u1', text: 'original' } });
    const { container } = renderTimeline({ messagesByConversation: new Map([['conv-1', [original, reply]]]) }, 2);
    const callSurface = container.querySelector('[data-surface="1"]')!;
    const callRoot = callSurface.querySelector('[data-scroll-root]')!;
    const mainRoot = container.querySelector('[data-surface="0"] [data-scroll-root]')!;
    await waitFor(() => expect(within(callSurface as HTMLElement).getAllByText('original').length).toBeGreaterThan(0));
    scrolled.length = 0;

    const quote = within(callSurface as HTMLElement).getAllByText('original').find((el) => el.closest('[data-msg-id="2"]'))!;
    fireEvent.click(quote);

    await waitFor(() => expect(scrolled.some((s) => s.el === callRoot)).toBe(true));
    expect(scrolled.some((s) => s.el === mainRoot)).toBe(false);
  });

  it('alvo fora da janela carregada: pede a janela em torno dele', async () => {
    const jumpToMessage = vi.fn();
    const reply = message(50, { text: 'resposta', replyTo: { msgId: 7, authorId: 'u1', text: 'antiga' } });
    renderTimeline({ messagesByConversation: new Map([['conv-1', [reply]]]), hasMoreByConversation: new Map([['conv-1', false]]), jumpToMessage });
    const quote = await screen.findByText('antiga');
    fireEvent.click(quote);
    expect(jumpToMessage).toHaveBeenCalledWith('conv-1', 7);
  });
});
