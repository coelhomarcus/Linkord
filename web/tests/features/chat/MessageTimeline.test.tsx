import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageTimeline } from '@/features/chat/MessageTimeline';

describe('MessageTimeline — regruda no final quando bottomPadding muda', () => {
  it('reajusta o scroll quando o composer flutuante assenta numa altura real (bottomPadding muda sem mensagem nova)', () => {
    const message: ChatMessage = { msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Fulana', avatar: '', text: 'oi', ts: Date.now() };
    const value = createFakeRoomContextValue({ messagesByConversation: new Map([['conv-1', [message]]]) });

    const { container, rerender } = render(
      <RoomContext.Provider value={value}>
        <MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
      </RoomContext.Provider>
    );

    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    expect(scrollEl).toBeTruthy();

    let fakeScrollHeight = 300;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => fakeScrollHeight });
    scrollEl.scrollTop = 0;

    // The floating composer measures its real height after the first paint
    // (bottomPadding goes from a guess to the real height) — this increases
    // the padding-bottom (and scrollHeight) of the scrollEl ITSELF, without
    // changing the size of contentRef (the child the ResizeObserver watches).
    fakeScrollHeight = 380;
    rerender(
      <RoomContext.Provider value={value}>
        <MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={100} />
      </RoomContext.Provider>
    );

    expect(scrollEl.scrollTop).toBe(380);
  });
});

describe('MessageTimeline — corrida entre resize (imagem/video carregando) e o evento scroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nao trava longe do final quando varias imagens terminam de carregar antes do evento scroll do snap anterior chegar', () => {
    let resizeCallback: ResizeObserverCallback = () => {};
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) { resizeCallback = cb; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const message: ChatMessage = { msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Fulana', avatar: '', text: 'oi', ts: Date.now() };
    const value = createFakeRoomContextValue({ messagesByConversation: new Map([['conv-1', [message]]]) });

    const { container } = render(
      <RoomContext.Provider value={value}>
        <MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
      </RoomContext.Provider>
    );

    const scrollEl = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    let fakeScrollHeight = 900;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => fakeScrollHeight });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, get: () => 400 });

    // An image finishes loading -> ResizeObserver fires -> snaps to the
    // bottom (scrollTop = 900). The snap sets programmaticScrollRef = true;
    // since requestAnimationFrame doesn't actually run in a synchronous
    // test, it stays true from here on, exactly like the real moment
    // between the scrollTop assignment and the async 'scroll' event it
    // triggers in the browser.
    resizeCallback([], {} as ResizeObserver);
    expect(scrollEl.scrollTop).toBe(900);

    // A SECOND, bigger image finishes loading before that async 'scroll'
    // event from the first snap arrives — scrollHeight grows again, but the
    // 'scroll' that fires now still carries the old scrollTop (900) relative
    // to the new scrollHeight (2000): without the guard, this would look
    // like "the user scrolled up" (gap much bigger than 80px).
    fakeScrollHeight = 2000;
    fireEvent.scroll(scrollEl);

    // The second image's ResizeObserver actually fires now — if the guard
    // worked, we're still "stuck to the bottom" and this snaps to the
    // current scrollHeight (2000). Without the guard, the scroll event above
    // would have knocked down stickToBottomRef and this call would be a no-op.
    resizeCallback([], {} as ResizeObserver);
    expect(scrollEl.scrollTop).toBe(2000);
  });
});

describe('MessageTimeline — salto para mensagem', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('com a mesma conversa em duas superficies, o salto so rola a lista que o pediu', () => {
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
    const original: ChatMessage = { msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Fulana', avatar: '', text: 'original', ts: Date.now() - 1000 };
    const reply: ChatMessage = {
      msgId: 2, conversationId: 'conv-1', id: 'u2', name: 'Beltrano', avatar: '', text: 'resposta', ts: Date.now(),
      replyTo: { msgId: 1, authorId: 'u1', text: 'original' },
    };
    const value = createFakeRoomContextValue({ messagesByConversation: new Map([['conv-1', [original, reply]]]) });

    const { container } = render(
      <RoomContext.Provider value={value}>
        <div data-surface="main"><MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} /></div>
        <div data-surface="call"><MessageTimeline conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} /></div>
      </RoomContext.Provider>
    );

    const callSurface = container.querySelector('[data-surface="call"]')!;
    const replyQuotes = screen.getAllByText('original').filter((el) => el.closest('[data-msg-id="2"]'));
    const callQuote = replyQuotes.find((el) => callSurface.contains(el))!;
    fireEvent.click(callQuote);

    expect(scrolled).toHaveLength(1);
    expect(callSurface.contains(scrolled[0]!)).toBe(true);
  });
});
