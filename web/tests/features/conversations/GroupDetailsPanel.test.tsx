import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial, ana, bea } from '@tests/fixtures/socialFixture';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { GroupDetailsPanel } from '@/features/conversations/GroupDetailsPanel';
import * as api from '@/shared/api/api';
import type { Conversation, PublicUser } from '@/shared/types/protocol';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriends: vi.fn(), fetchRequestSummary: vi.fn(), fetchGroupInvitations: vi.fn(), inviteToGroup: vi.fn(), revokeInvitation: vi.fn(),
}));
const mocked = vi.mocked(api);

const pub = (u: typeof ana): PublicUser => ({ ...u, banner: '', bio: '', profileLinks: [] } as unknown as PublicUser);
const group = (myRole: 'owner' | 'member'): Conversation => ({
  id: 'g1', type: 'group', title: 'Squad', avatar: '', createdBy: 'me', memberIds: ['me', 'u-ana'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole,
});
const friends = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchFriends.mockResolvedValue(friends(ana, bea));
  mocked.fetchGroupInvitations.mockResolvedValue({ items: [], nextCursor: null });
});

function setup(myRole: 'owner' | 'member') {
  const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } };
  return renderSocial(
    <AnimatedSidebarProvider>
      <GroupDetailsPanel conversationId="g1" open onOpenChange={vi.fn()} onOpenProfile={vi.fn()} />
    </AnimatedSidebarProvider>,
    { room: { state, conversations: [group(myRole)], allUsers: new Map([['u-ana', pub(ana)], ['me', { ...pub(ana), id: 'me', username: 'eu', displayName: 'Eu' }]]) } },
  );
}

describe('GroupDetailsPanel — convites', () => {
  it('dono convida amigos (que ainda nao sao membros) e nao adiciona direto', async () => {
    const user = userEvent.setup();
    mocked.inviteToGroup.mockResolvedValue({ results: [{ userId: 'u-bea', outcome: 'sent', invitationId: 'i' }] });
    setup('owner');

    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    // Ana já é membro, então só Bea aparece como candidata
    expect(await screen.findByRole('button', { name: /Bea/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana/, pressed: false })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bea/ }));
    await user.click(screen.getByRole('button', { name: 'Convidar (1)' }));
    expect(mocked.inviteToGroup).toHaveBeenCalledWith('g1', ['u-bea']);
    expect(await screen.findByText('Convites enviados.')).toBeInTheDocument();
  });

  it('lista convites pendentes, esconde quem ja foi convidado e revoga', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupInvitations.mockResolvedValue({ items: [{ id: 'inv-9', at: '2026-01-01T00:00:00.000Z', expiresAt: Date.now() + 1e8, invitee: bea }], nextCursor: null });
    mocked.revokeInvitation.mockResolvedValue({ invitation: {} as never });
    setup('owner');

    expect(await screen.findByText('Convites enviados')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Convidar amigos/ }));
    await waitFor(() => expect(screen.getByText('Você não tem amigos para convidar.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(mocked.revokeInvitation).toHaveBeenCalledWith('inv-9');
  });

  it('falha individual aparece com o motivo', async () => {
    const user = userEvent.setup();
    mocked.inviteToGroup.mockResolvedValue({ results: [{ userId: 'u-bea', outcome: 'cooldown' }] });
    setup('owner');
    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    await user.click(await screen.findByRole('button', { name: /Bea/ }));
    await user.click(screen.getByRole('button', { name: 'Convidar (1)' }));
    expect(await screen.findByText(/Bea: recusou há pouco/)).toBeInTheDocument();
  });

  it('membro comum nao ve convidar nem convites enviados (e nada e buscado)', async () => {
    setup('member');
    await screen.findByText('Squad');
    expect(screen.queryByRole('button', { name: /Convidar amigos/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Convites enviados')).not.toBeInTheDocument();
    expect(mocked.fetchGroupInvitations).not.toHaveBeenCalled();
  });
});
