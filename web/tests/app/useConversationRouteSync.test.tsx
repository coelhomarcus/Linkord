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
      <button type="button" onClick={() => navigate('/app/friends')}>ir para amigos</button>
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
  it('deep link para uma conversa conhecida a abre', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c2', { state: joined, conversations: [conv('c1'), conv('c2')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).toHaveBeenCalledWith('c2');
    expect(path()).toBe('/app/conversations/c2');
  });

  it('deep link para a conversa que ja esta ativa nao reabre nada', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c1', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
  });

  it('id desconhecido cai na lista e ela ganha o id da conversa ativa', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/fantasma', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1', openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
    expect(path()).toBe('/app/conversations/c1');
  });

  it('a selecao automatica inicial NAO arranca um deep link para /app/friends', () => {
    render(tree('/app/friends', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/friends');
  });

  it('uma abertura POSTERIOR (palette, notificacao, grupo criado) leva para a conversa', () => {
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

  it('rota sem id com conversa ativa e canonizada; com "awaitingOpen" espera a abertura', () => {
    const first = render(tree('/app/conversations', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations/c1');
    first.unmount();

    render(tree({ pathname: '/app/conversations', state: { awaitingOpen: true } }, { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations');
  });

  it('antes de entrar na sala (welcome nao chegou) nao faz nada', () => {
    const openConversation = vi.fn();
    render(tree('/app/conversations/c2', { state: initialRoomState, conversations: [], activeConversationId: null, openConversation }));
    expect(openConversation).not.toHaveBeenCalled();
    expect(path()).toBe('/app/conversations/c2');
  });

  it('sair da conversa para outra pagina NAO e desfeito pelo sync (navigate muda de identidade a cada rota)', async () => {
    const user = userEvent.setup();
    render(tree('/app/conversations/c1', { state: joined, conversations: [conv('c1')], activeConversationId: 'c1' }));
    expect(path()).toBe('/app/conversations/c1');

    await user.click(screen.getByRole('button', { name: 'ir para amigos' }));
    expect(path()).toBe('/app/friends');
  });
});
