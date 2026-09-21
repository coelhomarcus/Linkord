import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial, ana, bea } from '@tests/fixtures/socialFixture';
import { RequestsPage } from '@/features/friends/RequestsPage';
import { useFriends } from '@/features/friends/FriendsContext';
import * as api from '@/shared/api/api';

vi.mock('@/shared/PageHeader', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriendRequests: vi.fn(), fetchRequestSummary: vi.fn(), fetchReceivedInvitations: vi.fn(), acceptInvitation: vi.fn(), declineInvitation: vi.fn(), acceptFriendRequest: vi.fn(), declineFriendRequest: vi.fn(), cancelFriendRequest: vi.fn(),
}));
const mocked = vi.mocked(api);
const page = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 1, invitations: 0 });
});

describe('RequestsPage', () => {
  it('?tab=invitations abre direto na aba Convites', async () => {
    mocked.fetchReceivedInvitations.mockResolvedValue({ items: [], nextCursor: null });
    renderSocial(<RequestsPage onOpenProfile={vi.fn()} />, { path: '/app/requests?tab=invitations' });
    expect(await screen.findByText('Nenhum convite de grupo pendente.')).toBeInTheDocument();
    expect(mocked.fetchFriendRequests).not.toHaveBeenCalled();
  });

  it('abre nas recebidas e aceita sem pedir confirmacao', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockResolvedValue(page(ana));
    mocked.acceptFriendRequest.mockResolvedValue({});
    renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(mocked.fetchFriendRequests).toHaveBeenCalledWith('incoming', null);
    await user.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect(mocked.acceptFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('recusar chama o endpoint de recusa', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockResolvedValue(page(ana));
    mocked.declineFriendRequest.mockResolvedValue({});
    renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect(mocked.declineFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('enviadas: cada aba tem a propria lista (nunca "Aceitar" sobre uma solicitacao enviada)', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page(bea)));
    mocked.cancelFriendRequest.mockResolvedValue({});
    renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);

    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Enviadas' }));
    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocked.cancelFriendRequest).toHaveBeenCalledWith('u-bea');
  });

  it('acao que falha mostra o erro e mantem a linha', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockResolvedValue(page(ana));
    mocked.acceptFriendRequest.mockRejectedValue(new Error('x'));
    renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível concluir/);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
  });

  it('lista vazia diz isso, sem parecer erro', async () => {
    mocked.fetchFriendRequests.mockResolvedValue(page());
    renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);
    expect(await screen.findByText('Nenhuma solicitação recebida.')).toBeInTheDocument();
  });

  describe('aba Convites', () => {
    const entry = { id: 'inv-1', at: '2026-01-01T00:00:00.000Z', group: { id: 'g', title: 'Squad', avatar: '', memberCount: 3 }, inviter: ana };

    it('lista convites de grupo e aceita/recusa por id do convite', async () => {
      const user = userEvent.setup();
      mocked.fetchFriendRequests.mockResolvedValue(page());
      mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
      mocked.acceptInvitation.mockResolvedValue({ invitation: {} as never });
      mocked.declineInvitation.mockResolvedValue({ invitation: {} as never });
      renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);

      await user.click(await screen.findByRole('button', { name: 'Convites' }));
      expect(await screen.findByText('Squad')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Entrar' }));
      expect(mocked.acceptInvitation).toHaveBeenCalledWith('inv-1');
      await user.click(await screen.findByRole('button', { name: 'Recusar' }));
      expect(mocked.declineInvitation).toHaveBeenCalledWith('inv-1');
    });

    it('grupo cheio no aceite mostra o motivo', async () => {
      const user = userEvent.setup();
      mocked.fetchFriendRequests.mockResolvedValue(page());
      mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
      mocked.acceptInvitation.mockRejectedValue(new api.ApiError(409, 'group_full', 'x'));
      renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);

      await user.click(await screen.findByRole('button', { name: 'Convites' }));
      await user.click(await screen.findByRole('button', { name: 'Entrar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('O grupo está cheio.');
    });

    it('sem convites diz isso', async () => {
      const user = userEvent.setup();
      mocked.fetchFriendRequests.mockResolvedValue(page());
      mocked.fetchReceivedInvitations.mockResolvedValue({ items: [], nextCursor: null });
      renderSocial(<RequestsPage onOpenProfile={vi.fn()} />);
      await user.click(await screen.findByRole('button', { name: 'Convites' }));
      expect(await screen.findByText('Nenhum convite de grupo pendente.')).toBeInTheDocument();
    });
  });
});

describe('FriendsContext — badge', () => {
  it('soma solicitacoes recebidas e convites de grupo pendentes', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 1, invitations: 2 });
    function Badge() {
      const { pendingIncomingCount, pendingInvitationCount } = useFriends();
      return <p>{`total ${pendingIncomingCount} / convites ${pendingInvitationCount}`}</p>;
    }
    renderSocial(<Badge />);
    expect(await screen.findByText('total 3 / convites 2')).toBeInTheDocument();
  });
});
