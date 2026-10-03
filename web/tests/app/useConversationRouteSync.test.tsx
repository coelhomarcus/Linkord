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
import { conversationIdFromState } from '@/shared/lib/routes';

const conv = (id: string): Conversation => ({
  id, type: 'group', title: id, avatar: '', createdBy: null, memberIds: [], lastMessageAt: null,
  createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
});
const joined = { ...initialRoomState, joined: true };

function Probe() {
  useConversationRouteSync();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <p data-testid="path">{location.pathname}</p>
      <p data-testid="entry-id">{conversationIdFromState(location.state) ?? ''}</p>
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
const entryId = () => screen.getByTestId('entry-id').textContent;
const entryFor = (id: string) => ({ pathname: '/app/conversations', state: { conversationId: id } });

describe('useConversationRouteSync', () => {
  it('an entry naming a known conversation (refresh, back/forward) opens it', () => {
    const openConversation = vi.fn();
    render(tree(entryFor('c2'), { state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).toHaveBeenCalledWith('c2');
    expect(path()).toBe('/app/conversations');
    expect(entryId()).toBe('c2');
  });

  it('an entry naming the conversation already active reopens nothing', () => {
    const openConversation = vi.fn();
    render(tree(entryFor('c1'), { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
  });

  it('a legacy /app/conversations/:id link opens the conversation and is rewritten to the bare path', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c2', { state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).toHaveBeenCalledWith('c2');
    expect(path()).toBe('/app/conversations');
    expect(entryId()).toBe('c2');
  });

  it('an unknown id falls back to the list, which gets the active conversation id', () => {
    const openConversation = vi.fn();
    render(tree(entryFor('ghost'), { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
    expect(path()).toBe('/app/conversations');
    expect(entryId()).toBe('c1');
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
    expect(path()).toBe('/app/conversations');
    expect(entryId()).toBe('c2');
  });

  it('the bare route with an active conversation gets its id; with "awaitingOpen" it waits for the open', () => {
    const first = render(tree('/app/conversations', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations');
    expect(entryId()).toBe('c1');
    first.unmount();

    render(tree({ pathname: '/app/conversations', state: { awaitingOpen: true } }, { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(entryId()).toBe('');
  });

  it('before joining the room (welcome not received yet) does nothing', () => {
    const openConversation = vi.fn();
    render(tree(entryFor('c2'), { state: initialRoomState, conversations: [], activeConversationId: null, openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
    expect(entryId()).toBe('c2');
  });

  it('leaving the conversation for another page is NOT undone by the sync (navigate changes identity on every route)', async () => {
    const user = userEvent.setup();
    render(tree(entryFor('c1'), { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations');

    await user.click(screen.getByRole('button', { name: 'go to friends' }));
    expect(path()).toBe('/app/friends');
  });
});
