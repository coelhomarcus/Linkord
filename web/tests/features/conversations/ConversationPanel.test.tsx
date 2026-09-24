import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { ChatMessage } from '@/shared/types/protocol';
import { ConversationPanel, MessageList, MessageListBridge } from '@/features/conversations/ConversationPanel';
import type { Conversation } from '@/shared/types/protocol';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { renderSocial } from '@tests/fixtures/socialFixture';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(),
}));
const mockedApi = vi.mocked(api);

// the direct-conversation gate needs the friends provider — covered by its
// own tests (tests/features/friends/DirectComposerGate.test.tsx)
vi.mock('@/features/friends/DirectComposerGate', () => ({ DirectComposerGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const joinedState = { ...initialRoomState, joined: true };

function fakeFile(name: string, type: string): File {
  return new File(['conteudo'], name, { type });
}

function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { files, types: ['Files'] };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('MessageListBridge — drag and drop', () => {
  it('mostra overlay ao arrastar arquivo sobre a conversa e some ao soltar', () => {
    const { container } = renderWithRoom(
      <MessageListBridge conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: joinedState }
    );
    const dropzone = container.firstElementChild!;

    fireEvent.dragEnter(dropzone, { dataTransfer: { files: [], types: ['Files'] } });
    expect(screen.getByText('Solte para anexar')).toBeInTheDocument();

    fireEvent.drop(dropzone, { dataTransfer: { files: [fakeFile('foto.jpg', 'image/jpeg')], types: ['Files'] } });
    expect(screen.queryByText('Solte para anexar')).not.toBeInTheDocument();
  });

  it('soltar um arquivo o anexa na mensagem (aparece como pendente no composer)', () => {
    const { container } = renderWithRoom(
      <MessageListBridge conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: joinedState }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('relatorio.pdf', 'application/pdf')]);

    expect(screen.getByText('relatorio.pdf')).toBeInTheDocument();
  });

  it('nao anexa nada quando o usuario ainda nao entrou na conversa', () => {
    const { container } = renderWithRoom(
      <MessageListBridge conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: { ...initialRoomState, joined: false } }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('foto.jpg', 'image/jpeg')]);

    expect(screen.queryByText('Solte para anexar')).not.toBeInTheDocument();
  });
});

describe('MessageList — regruda no final quando bottomPadding muda', () => {
  it('reajusta o scroll quando o composer flutuante assenta numa altura real (bottomPadding muda sem mensagem nova)', () => {
    const message: ChatMessage = { msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Fulana', avatar: '', text: 'oi', ts: Date.now() };
    const value = createFakeRoomContextValue({ messagesByConversation: new Map([['conv-1', [message]]]) });

    const { container, rerender } = render(
      <RoomContext.Provider value={value}>
        <MessageList conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
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
        <MessageList conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={100} />
      </RoomContext.Provider>
    );

    expect(scrollEl.scrollTop).toBe(380);
  });
});

describe('MessageList — corrida entre resize (imagem/video carregando) e o evento scroll', () => {
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
        <MessageList conversationId="conv-1" onReply={() => {}} onOpenProfile={() => {}} bottomPadding={24} />
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

describe('ConversationPanel — erro ao entrar na chamada', () => {
  const direct: Conversation = {
    id: 'c1', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
  };
  const me = { ...joinedState, me: { ...initialRoomState.me, userId: 'me' } };

  function renderPanel(room: Partial<RoomContextValue>) {
    const onOpenCall = vi.fn();
    renderSocial(
      <AnimatedSidebarProvider>
        <ConversationPanel onOpenProfile={() => {}} onOpenCall={onOpenCall} onOpenSearch={() => {}} onOpenDetails={() => {}} onOpenMedia={() => {}} />
      </AnimatedSidebarProvider>,
      { room: { state: me, conversations: [direct], activeConversationId: 'c1', ...room } },
    );
    return { onOpenCall };
  }

  afterEach(() => { vi.clearAllMocks(); });

  it('mostra o erro de uma chamada que nao conseguiu comecar, so na conversa dela', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    const dispatch = vi.fn();
    renderPanel({ dispatch, state: { ...me, callJoinError: { conversationId: 'c1', message: 'Vídeo/voz indisponível no momento.' } } });
    expect(screen.getByRole('alert')).toHaveTextContent('Vídeo/voz indisponível no momento.');
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: null });
  });

  it('erro de chamada de outra conversa nao aparece aqui', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    renderPanel({ state: { ...me, callJoinError: { conversationId: 'outra', message: 'falhou' } } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
