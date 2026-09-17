import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageList, MessageListBridge } from '@/features/conversations/ConversationPanel';

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

    // O composer flutuante mede sua altura real depois do primeiro paint
    // (bottomPadding vai de um chute pra altura de verdade) — isso aumenta
    // o padding-bottom (e o scrollHeight) do PROPRIO scrollEl, sem mudar o
    // tamanho do contentRef (o filho que o ResizeObserver observa).
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

    // Uma imagem termina de carregar -> ResizeObserver dispara -> gruda no
    // final (scrollTop = 900). O snap marca programmaticScrollRef = true;
    // como requestAnimationFrame nao roda de verdade num teste sincrono,
    // ele continua true daqui pra frente, exatamente como no instante real
    // entre a atribuicao de scrollTop e o evento 'scroll' assincrono que ela
    // dispara no navegador.
    resizeCallback([], {} as ResizeObserver);
    expect(scrollEl.scrollTop).toBe(900);

    // Uma SEGUNDA imagem, maior, termina de carregar antes desse evento
    // 'scroll' assincrono do primeiro snap chegar — scrollHeight cresce de
    // novo, mas o 'scroll' que dispara agora ainda carrega o scrollTop
    // antigo (900) relativo ao scrollHeight novo (2000): sem a guarda, isso
    // pareceria "o usuario rolou pra cima" (gap bem maior que 80px).
    fakeScrollHeight = 2000;
    fireEvent.scroll(scrollEl);

    // O ResizeObserver da segunda imagem dispara de verdade agora — se a
    // guarda funcionou, ainda estamos "colados no final" e isso gruda no
    // scrollHeight atual (2000). Sem a guarda, o evento scroll acima teria
    // derrubado stickToBottomRef e essa chamada seria um no-op.
    resizeCallback([], {} as ResizeObserver);
    expect(scrollEl.scrollTop).toBe(2000);
  });
});
