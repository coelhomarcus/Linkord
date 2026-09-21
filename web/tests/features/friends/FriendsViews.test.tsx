import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial, ana, bea } from '@tests/fixtures/socialFixture';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { useFriends } from '@/features/friends/FriendsContext';
import * as api from '@/shared/api/api';

vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, middle, actions }: { title: string; middle?: React.ReactNode; actions?: React.ReactNode }) => (<header><h1>{title}</h1>{middle}{actions}</header>),
}));
vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriends: vi.fn(), fetchRequestSummary: vi.fn(), fetchFriendRequests: vi.fn(), fetchReceivedInvitations: vi.fn(),
  acceptInvitation: vi.fn(), declineInvitation: vi.fn(), acceptFriendRequest: vi.fn(), declineFriendRequest: vi.fn(), cancelFriendRequest: vi.fn(),
}));
const mocked = vi.mocked(api);

const me = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };
const page = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });
const at = (path: string) => renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me }, path });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchFriends.mockResolvedValue(page(ana));
  mocked.fetchFriendRequests.mockResolvedValue(page());
  mocked.fetchReceivedInvitations.mockResolvedValue({ items: [], nextCursor: null });
});

describe('Amigos — a visao vem da URL', () => {
  it('sem tab abre em Todos; a visao atual e marcada como pagina atual', async () => {
    at('/app/friends');
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'page');
  });

  it('?tab=pending abre Pendentes com Recebidas e Enviadas na mesma pagina', async () => {
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page(bea)));
    at('/app/friends?tab=pending');
    expect(await screen.findByRole('heading', { level: 2, name: 'Recebidas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Enviadas' })).toBeInTheDocument();
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(mocked.fetchFriends).not.toHaveBeenCalled();
  });

  it('?tab=invitations abre direto nos Convites', async () => {
    at('/app/friends?tab=invitations');
    expect(await screen.findByText('Nenhum convite de grupo pendente.')).toBeInTheDocument();
    expect(mocked.fetchFriendRequests).not.toHaveBeenCalled();
  });

  it('?tab=add abre o formulario e o username para compartilhar', async () => {
    at('/app/friends?tab=add');
    expect(await screen.findByPlaceholderText('@nomedeusuario')).toBeInTheDocument();
    expect(screen.getByText('@fulana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adicionar amigo' })).toHaveAttribute('aria-current', 'page');
  });

  it('tab desconhecida cai em Todos (sem pagina vazia)', async () => {
    at('/app/friends?tab=naoexiste');
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'page');
  });

  it('trocar de visao navega pela URL', async () => {
    const user = userEvent.setup();
    at('/app/friends');
    await screen.findByText('Ana');
    await user.click(screen.getByRole('link', { name: /Pendentes/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Recebidas' })).toBeInTheDocument();
  });

  it('a busca vem de ?q= e vai para o servidor', async () => {
    at('/app/friends?q=an');
    await waitFor(() => expect(mocked.fetchFriends).toHaveBeenCalledWith(null, 'an'));
    expect(screen.getByLabelText('Buscar nos seus amigos')).toHaveValue('an');
  });

  it('badges dos modos distinguem solicitacoes e convites', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 2, invitations: 1 });
    at('/app/friends');
    expect(await screen.findByLabelText('2 solicitações aguardando resposta')).toBeInTheDocument();
    expect(screen.getByLabelText('1 convites aguardando resposta')).toBeInTheDocument();
  });
});

describe('Amigos — Pendentes', () => {
  it('aceita recebida sem pedir confirmacao', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page()));
    mocked.acceptFriendRequest.mockResolvedValue({});
    at('/app/friends?tab=pending');

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(mocked.fetchFriendRequests).toHaveBeenCalledWith('incoming', null);
    await user.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect(mocked.acceptFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('recusar chama o endpoint de recusa', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page()));
    mocked.declineFriendRequest.mockResolvedValue({});
    at('/app/friends?tab=pending');
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect(mocked.declineFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('enviadas: so Cancelar (nunca Aceitar sobre uma solicitacao enviada)', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page() : page(bea)));
    mocked.cancelFriendRequest.mockResolvedValue({});
    at('/app/friends?tab=pending');

    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocked.cancelFriendRequest).toHaveBeenCalledWith('u-bea');
  });

  it('acao que falha mostra o erro e mantem a linha', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page()));
    mocked.acceptFriendRequest.mockRejectedValue(new Error('x'));
    at('/app/friends?tab=pending');

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível concluir/);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
  });

  it('cada secao diz quando esta vazia, sem parecer erro', async () => {
    at('/app/friends?tab=pending');
    expect(await screen.findByText('Nenhuma solicitação recebida.')).toBeInTheDocument();
    expect(screen.getByText('Você não tem solicitações enviadas.')).toBeInTheDocument();
  });
});

describe('Amigos — Convites de grupo', () => {
  const entry = { id: 'inv-1', at: '2026-01-01T00:00:00.000Z', group: { id: 'g', title: 'Squad', avatar: '', memberCount: 3 }, inviter: ana };

  it('lista convites e aceita/recusa por id do convite', async () => {
    const user = userEvent.setup();
    mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
    mocked.acceptInvitation.mockResolvedValue({ invitation: {} as never });
    mocked.declineInvitation.mockResolvedValue({ invitation: {} as never });
    at('/app/friends?tab=invitations');

    expect(await screen.findByText('Squad')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(mocked.acceptInvitation).toHaveBeenCalledWith('inv-1');
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect(mocked.declineInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('grupo cheio no aceite mostra o motivo', async () => {
    const user = userEvent.setup();
    mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
    mocked.acceptInvitation.mockRejectedValue(new api.ApiError(409, 'group_full', 'x'));
    at('/app/friends?tab=invitations');

    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O grupo está cheio.');
  });
});

describe('FriendsContext — contagens', () => {
  it('separa solicitacoes recebidas, convites e a soma do que aguarda resposta', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 1, invitations: 2 });
    function Badge() {
      const { pendingFriendRequestCount, pendingIncomingCount, pendingInvitationCount } = useFriends();
      return <p>{`pedidos ${pendingFriendRequestCount} / convites ${pendingInvitationCount} / total ${pendingIncomingCount}`}</p>;
    }
    renderSocial(<Badge />);
    expect(await screen.findByText('pedidos 1 / convites 2 / total 3')).toBeInTheDocument();
  });
});
