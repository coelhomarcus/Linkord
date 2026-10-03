import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import type { PublicUser } from '@/shared/types/protocol';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';

// the direct-conversation gate needs the friends provider — covered by its
// own tests (tests/features/friends/DirectComposerGate.test.tsx)
vi.mock('@/features/friends/DirectComposerGate', () => ({ DirectComposerGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const joinedState = { ...initialRoomState, joined: true };

afterEach(() => clearAllDrafts());

function fakeFile(name: string, type: string): File {
  return new File(['content'], name, { type });
}

function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { files, types: ['Files'] };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('ChatSurface — drag and drop', () => {
  it('shows an overlay while dragging a file over the conversation and hides it on drop', () => {
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

  it('dropping a file attaches it to the message (shows up as pending in the composer)', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: joinedState }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('relatorio.pdf', 'application/pdf')]);

    expect(screen.getByTitle('relatorio.pdf')).toBeInTheDocument();
  });

  it('attaches nothing when the user has not joined the conversation yet', () => {
    const { container } = renderWithRoom(
      <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />,
      { state: { ...initialRoomState, joined: false } }
    );
    const dropzone = container.firstElementChild!;

    dropFiles(dropzone, [fakeFile('foto.jpg', 'image/jpeg')]);

    expect(screen.queryByText('Solte para anexar')).not.toBeInTheDocument();
  });
});

describe('ChatSurface — typing does not shift the list', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const fulano: PublicUser = { id: 'u1', username: 'fulano', displayName: 'Fulano', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };

  it('the indicator sits outside the measured area and the list height stays put when someone starts typing', () => {
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    });
    const surface = (typing: Set<string>) => (
      <RoomContext.Provider value={createFakeRoomContextValue({
        state: joinedState,
        allUsers: new Map([['u1', fulano]]),
        typingByConversation: new Map([['conv-1', typing]]),
        messagesByConversation: new Map([['conv-1', [{ msgId: 1, conversationId: 'conv-1', id: 'u1', name: 'Fulano', avatar: '', text: 'oi', ts: 1 }]]]),
      })}>
        <ChatSurface conversationId="conv-1" onOpenProfile={() => {}} />
      </RoomContext.Provider>
    );
    const { container, rerender } = render(surface(new Set()));
    const scrollEl = container.querySelector('[data-scroll-root]') as HTMLElement;
    // the composer's reserved space is part of the virtual list's height now
    const listHeight = () => (container.querySelector('[role="log"]') as HTMLElement).style.height;
    const heightBefore = listHeight();

    rerender(surface(new Set(['u1'])));

    const typing = screen.getByText('Fulano está digitando...');
    // the surface root is observed too, but only for its width
    const heightObserved = observed.filter((el) => !el.contains(scrollEl));
    expect(heightObserved.length).toBeGreaterThan(0);
    expect(heightObserved.some((el) => el.contains(typing))).toBe(false);
    expect(listHeight()).toBe(heightBefore);
  });
});
