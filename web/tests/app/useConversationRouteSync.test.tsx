import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { useConversationRouteSync } from '@/app/useConversationRouteSync';

const conv = (id: string): Conversation => ({
  id, type: 'group', title: id, avatar: '', createdBy: null, memberIds: [], lastMessageAt: null,
  createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
});
const joined = { ...initialRoomState, joined: true };

function Probe() {
  useConversationRouteSync();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="path">{useLocation().pathname}</p>
      <button type="button" onClick={() => navigate('/app/friends')}>go to friends</button>
    </>
  );
}

function tree(entry: string | { pathname: string; state: unknown }, room: Partial<RoomContextValue>) {
  return (
    <RoomContext.Provider value={createFakeRoomContextValue(room)}>
      <MemoryRouter initialEntries={[entry as string]}><Probe /></MemoryRouter>
    </RoomContext.Provider>
  );
}
const path = () => screen.getByTestId('path').textContent;

describe('useConversationRouteSync', () => {
  it('deep link to a known conversation opens it', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c2', { state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).toHaveBeenCalledWith('c2');
    expect(path()).toBe('/app/conversations/c2');
  });

  it('deep link to the conversation already active reopens nothing', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c1', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
  });

  it('unknown id falls back to the list, which gets the active conversation id', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/ghost', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
    expect(path()).toBe('/app/conversations/c1');
  });

  it('the initial automatic selection does NOT trigger a deep link to /app/friends', () => {
    render(tree('/app/friends', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/friends');
  });

  it('a LATER open (palette, notification, group created) navigates to the conversation', () => {
    const room = (active: string) => createFakeRoomContextValue({ state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: active });
    const view = (active: string) => (
      <RoomContext.Provider value={room(active)}>
        <MemoryRouter initialEntries={['/app/friends']}><Probe /></MemoryRouter>
      </RoomContext.Provider>
    );
    const { rerender } = render(view('c1'));
    expect(path()).toBe('/app/friends');
    rerender(view('c2'));
    expect(path()).toBe('/app/conversations/c2');
  });

  it('route without id with an active conversation is canonicalized; with "awaitingOpen" it waits for the open', () => {
    const first = render(tree('/app/conversations', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations/c1');
    first.unmount();

    render(tree({ pathname: '/app/conversations', state: { awaitingOpen: true } }, { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations');
  });

  it('before joining the room (welcome not received yet) does nothing', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c2', { state: initialRoomState, conversations: [], activeConversationId: null, openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
    expect(path()).toBe('/app/conversations/c2');
  });

  it('leaving the conversation for another page is NOT undone by the sync (navigate changes identity on every route)', async () => {
    const user = userEvent.setup();
    render(tree('/app/conversations/c1', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations/c1');

    await user.click(screen.getByRole('button', { name: 'go to friends' }));
    expect(path()).toBe('/app/friends');
  });
});
