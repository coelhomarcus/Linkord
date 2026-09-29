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
  fetchFriends: vi.fn(), fetchGroupMembers: vi.fn(), fetchRequestSummary: vi.fn(), fetchGroupInvitations: vi.fn(), inviteToGroup: vi.fn(), revokeInvitation: vi.fn(),
}));
const mocked = vi.mocked(api);

const pub = (u: typeof ana): PublicUser => ({ ...u, banner: '', bio: '', profileLinks: [] } as unknown as PublicUser);
const group = (myRole: 'owner' | 'member'): Conversation => ({
  id: 'g1', type: 'group', title: 'Squad', avatar: '', createdBy: 'me', memberIds: ['me', 'u-ana'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole, ownerId: 'me', memberCount: 2,
});
const friends = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

const me = { id: 'me', username: 'eu', displayName: 'Eu', avatar: '', avatarColor: 'green' };
const memberPage = (nextCursor: string | null = null) => ({
  items: [{ user: me, role: 'owner' as const, at: '2026-01-01T00:00:00.000Z' }, { user: ana, role: 'member' as const, at: '2026-01-02T00:00:00.000Z' }],
  nextCursor,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchGroupMembers.mockResolvedValue(memberPage());
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

describe('GroupDetailsPanel — invitations', () => {
  it('owner invites friends (who are not yet members) and does not add them directly', async () => {
    const user = userEvent.setup();
    mocked.inviteToGroup.mockResolvedValue({ results: [{ userId: 'u-bea', outcome: 'sent', invitationId: 'i' }] });
    setup('owner');

    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    // Ana is already a member, so only Bea shows up as a candidate
    expect(await screen.findByRole('button', { name: /Bea/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana/, pressed: false })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bea/ }));
    await user.click(screen.getByRole('button', { name: 'Convidar (1)' }));
    expect(mocked.inviteToGroup).toHaveBeenCalledWith('g1', ['u-bea']);
    expect(await screen.findByText('Convites enviados.')).toBeInTheDocument();
  });

  it('lists pending invitations, hides those already invited, and revokes', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupInvitations.mockResolvedValue({ items: [{ id: 'inv-9', at: '2026-01-01T00:00:00.000Z', invitee: bea }], nextCursor: null });
    mocked.revokeInvitation.mockResolvedValue({ invitation: {} as never });
    setup('owner');

    expect(await screen.findByText('Convites enviados')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Convidar amigos/ }));
    await waitFor(() => expect(screen.getByText('Você não tem amigos para convidar.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(mocked.revokeInvitation).toHaveBeenCalledWith('inv-9');
  });

  it('an individual failure shows up with its reason', async () => {
    const user = userEvent.setup();
    mocked.inviteToGroup.mockResolvedValue({ results: [{ userId: 'u-bea', outcome: 'not_friends' }] });
    setup('owner');
    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    await user.click(await screen.findByRole('button', { name: /Bea/ }));
    await user.click(screen.getByRole('button', { name: 'Convidar (1)' }));
    expect(await screen.findByText(/Bea: não é mais seu amigo/)).toBeInTheDocument();
  });

  it('a regular member does not see invite or sent invitations (and nothing is fetched)', async () => {
    setup('member');
    await screen.findByText('Squad');
    expect(screen.queryByRole('button', { name: /Convidar amigos/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Convites enviados')).not.toBeInTheDocument();
    expect(mocked.fetchGroupInvitations).not.toHaveBeenCalled();
  });

  it('the member list is paginated from the server, with the owner marked', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupMembers.mockResolvedValueOnce(memberPage('cursor-2')).mockResolvedValueOnce({
      items: [{ user: bea, role: 'member', at: '2026-01-03T00:00:00.000Z' }], nextCursor: null,
    });
    setup('owner');

    expect(await screen.findByText('dono')).toBeInTheDocument();
    expect(screen.getByText('2 membros')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(mocked.fetchGroupMembers).toHaveBeenLastCalledWith('g1', 'cursor-2');
    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('owner sees transfer/remove on others; a regular member sees no management controls', async () => {
    const { unmount } = setup('owner');
    expect(await screen.findByRole('button', { name: 'Remover Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transferir propriedade para Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover Eu/ })).not.toBeInTheDocument();
    unmount();

    setup('member');
    await screen.findByText('Ana');
    expect(screen.queryByRole('button', { name: /Remover/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sair do grupo/ })).toBeInTheDocument();
  });

  it('an error loading members offers a retry', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupMembers.mockRejectedValueOnce(new Error('x'));
    setup('member');
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });

  it('any member can report the group', async () => {
    const user = userEvent.setup();
    setup('member');
    await user.click(await screen.findByRole('button', { name: /Denunciar grupo/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Denunciar grupo');
  });
});
