import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';

// the direct-conversation gate needs the friends provider — covered by its
// own tests (tests/features/friends/DirectComposerGate.test.tsx)
vi.mock('@/features/friends/DirectComposerGate', () => ({ DirectComposerGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const joinedState = { ...initialRoomState, joined: true };

afterEach(() => clearAllDrafts());

function fakeFile(name: string, type: string): File {
  return new File(['conteudo'], name, { type });
}

function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { files, types: ['Files'] };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('ChatSurface — drag and drop', () => {
  it('mostra overlay ao arrastar arquivo sobre a conversa e some ao soltar', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
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
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: joinedState }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('relatorio.pdf', 'application/pdf')]);

    expect(screen.getByText('relatorio.pdf')).toBeInTheDocument();
  });

  it('nao anexa nada quando o usuario ainda nao entrou na conversa', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: { ...initialRoomState, joined: false } }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('foto.jpg', 'image/jpeg')]);

    expect(screen.queryByText('Solte para anexar')).not.toBeInTheDocument();
  });
});
