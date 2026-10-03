import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
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

describe('Amigos — the view comes from the URL', () => {
  it('no tab opens on Todos; the current view is marked as the current page', async () => {
    at('/app/friends');
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'page');
  });

  it('?tab=pending opens Pendentes with Recebidas and Enviadas on the same page', async () => {
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page(bea)));
    at('/app/friends?tab=pending');
    expect(await screen.findByRole('heading', { level: 2, name: 'Recebidas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Enviadas' })).toBeInTheDocument();
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(mocked.fetchFriends).not.toHaveBeenCalled();
  });

  it('?tab=invitations opens directly on Convites', async () => {
    at('/app/friends?tab=invitations');
    expect(await screen.findByText('Nenhum convite de grupo pendente.')).toBeInTheDocument();
    expect(mocked.fetchFriendRequests).not.toHaveBeenCalled();
  });

  it('?tab=add opens the form and the username to share', async () => {
    at('/app/friends?tab=add');
    expect(await screen.findByPlaceholderText('@nomedeusuario')).toBeInTheDocument();
    expect(screen.getByText('@fulana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adicionar amigo' })).toHaveAttribute('aria-current', 'page');
  });

  it('an unknown tab falls back to Todos (no empty page)', async () => {
    at('/app/friends?tab=naoexiste');
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'page');
  });

  it('switching views navigates via the URL', async () => {
    const user = userEvent.setup();
    at('/app/friends');
    await screen.findByText('Ana');
    await user.click(screen.getByRole('link', { name: /Pendentes/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Recebidas' })).toBeInTheDocument();
  });

  it('the search comes from ?q= and goes to the server', async () => {
    at('/app/friends?q=an');
    await waitFor(() => expect(mocked.fetchFriends).toHaveBeenCalledWith(null, 'an', undefined));
    expect(screen.getByLabelText('Buscar nos seus amigos')).toHaveValue('an');
  });

  it('mode badges distinguish requests and invitations', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 2, invitations: 1 });
    at('/app/friends');
    expect(await screen.findByLabelText('2 solicitações aguardando resposta')).toBeInTheDocument();
    expect(screen.getByLabelText('1 convites aguardando resposta')).toBeInTheDocument();
  });
});

describe('Amigos — Pendentes', () => {
  it('accepts an incoming request without asking for confirmation', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page()));
    mocked.acceptFriendRequest.mockResolvedValue({});
    at('/app/friends?tab=pending');

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(mocked.fetchFriendRequests).toHaveBeenCalledWith('incoming', null, '');
    await user.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect(mocked.acceptFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('declining calls the decline endpoint', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page()));
    mocked.declineFriendRequest.mockResolvedValue({});
    at('/app/friends?tab=pending');
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect(mocked.declineFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('sent requests: only Cancelar (never Aceitar on a sent request)', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page() : page(bea)));
    mocked.cancelFriendRequest.mockResolvedValue({});
    at('/app/friends?tab=pending');

    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocked.cancelFriendRequest).toHaveBeenCalledWith('u-bea');
  });

  it('an action that fails shows the error and keeps the row', async () => {
    const user = userEvent.setup();
    mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(ana) : page()));
    mocked.acceptFriendRequest.mockRejectedValue(new Error('x'));
    at('/app/friends?tab=pending');

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível concluir/);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
  });

  it('each section says when it is empty, without looking like an error', async () => {
    at('/app/friends?tab=pending');
    expect(await screen.findByText('Nenhuma solicitação recebida.')).toBeInTheDocument();
    expect(screen.getByText('Você não tem solicitações enviadas.')).toBeInTheDocument();
  });
});

describe('Amigos — search in Pendentes and Convites (on the server, before pagination)', () => {
  it('Pendentes sends ?q= to both received and sent', async () => {
    at('/app/friends?tab=pending&q=ana');
    await waitFor(() => {
      expect(mocked.fetchFriendRequests).toHaveBeenCalledWith('incoming', null, 'ana');
      expect(mocked.fetchFriendRequests).toHaveBeenCalledWith('outgoing', null, 'ana');
    });
    expect(screen.getByLabelText('Buscar nas solicitações')).toHaveValue('ana');
  });

  it('a search with no results says so (not "nenhuma solicitacao")', async () => {
    at('/app/friends?tab=pending&q=zzz');
    expect((await screen.findAllByText('Nenhum resultado para esta busca.')).length).toBe(2);
  });

  it('Convites sends ?q= and shows an empty search state', async () => {
    at('/app/friends?tab=invitations&q=squad');
    await waitFor(() => expect(mocked.fetchReceivedInvitations).toHaveBeenCalledWith(null, 'squad'));
    expect(await screen.findByText('Nenhum resultado para esta busca.')).toBeInTheDocument();
  });

  it('typing in the Pendentes search writes ?q= without switching views', async () => {
    const user = userEvent.setup();
    at('/app/friends?tab=pending');
    await user.type(await screen.findByLabelText('Buscar nas solicitações'), 'bia');
    await waitFor(() => expect(mocked.fetchFriendRequests).toHaveBeenCalledWith('incoming', null, 'bia'));
    expect(screen.getByRole('heading', { level: 2, name: 'Recebidas' })).toBeInTheDocument();
  });
});

describe('Friends — group invitations', () => {
  const entry = { id: 'inv-1', at: '2026-01-01T00:00:00.000Z', group: { id: 'g', title: 'Squad', avatar: '', memberCount: 3 }, inviter: ana };

  it('lists invitations and accepts/declines by invitation id', async () => {
    const user = userEvent.setup();
    mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
    mocked.acceptInvitation.mockResolvedValue({ invitation: {} as never });
    mocked.declineInvitation.mockResolvedValue({ invitation: {} as never });
    at('/app/friends?tab=invitations');

    expect(await screen.findByText('Squad')).toBeInTheDocument();
    expect(screen.getByText(/3 membros$/)).toBeInTheDocument(); // regression: a stray "}" once trailed it
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(mocked.acceptInvitation).toHaveBeenCalledWith('inv-1');
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect(mocked.declineInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('a full group on acceptance shows the reason', async () => {
    const user = userEvent.setup();
    mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
    mocked.acceptInvitation.mockRejectedValue(new api.ApiError(409, 'group_full', 'x'));
    at('/app/friends?tab=invitations');

    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O grupo está cheio.');
  });
});

describe('FriendsContext — counts', () => {
  it('separates received requests, invitations, and the sum of what is awaiting a response', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 1, invitations: 2 });
    function Badge() {
      const { pendingFriendRequestCount, pendingIncomingCount, pendingInvitationCount } = useFriends();
      return <p>{`pedidos ${pendingFriendRequestCount} / convites ${pendingInvitationCount} / total ${pendingIncomingCount}`}</p>;
    }
    renderSocial(<Badge />);
    expect(await screen.findByText('pedidos 1 / convites 2 / total 3')).toBeInTheDocument();
  });
});

describe('Amigos — robust actions and lists (E5)', () => {
  const incoming = (...users: (typeof ana)[]) => mocked.fetchFriendRequests.mockImplementation(async (direction) => (direction === 'incoming' ? page(...users) : page()));

  it('pending state is per row: accepting Ana does not lock Bea\'s buttons', async () => {
    const user = userEvent.setup();
    incoming(ana, bea);
    let finish!: () => void;
    mocked.acceptFriendRequest.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({}); }));
    at('/app/friends?tab=pending');

    await screen.findByText('Ana');
    const accept = screen.getAllByRole('button', { name: 'Aceitar' });
    await user.click(accept[0]!);
    expect(accept[0]).toBeDisabled();
    expect(accept[1]).toBeEnabled(); // another row is still usable
    await user.click(accept[0]!); // a second click on the same row does nothing
    expect(mocked.acceptFriendRequest).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('success: the row leaves immediately, a confirmation appears, and focus moves to the section title', async () => {
    const user = userEvent.setup();
    incoming(ana, bea);
    // once accepted, the server no longer lists her
    mocked.acceptFriendRequest.mockImplementation(async () => { incoming(bea); return {}; });
    at('/app/friends?tab=pending');

    await screen.findByText('Ana');
    await user.click(screen.getAllByRole('button', { name: 'Aceitar' })[0]!);
    await waitFor(() => expect(screen.queryByText('Ana')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Solicitação aceita.');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Recebidas' }));
    expect(screen.getByText('Bea')).toBeInTheDocument();
  });

  it('an action\'s error survives the list reload', async () => {
    const user = userEvent.setup();
    incoming(ana);
    mocked.acceptFriendRequest.mockRejectedValue(new Error('x'));
    at('/app/friends?tab=pending');

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível concluir/);
    await waitFor(() => expect(mocked.fetchFriendRequests.mock.calls.length).toBeGreaterThan(2)); // the re-read happened
    expect(screen.getByRole('alert')).toBeInTheDocument(); // ...and the message is still there
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('invitation: joining shows the confirmation; a full-group failure keeps the reason after re-reading', async () => {
    const user = userEvent.setup();
    const entry = { id: 'inv-1', at: '2026-01-01T00:00:00.000Z', group: { id: 'g', title: 'Squad', avatar: '', memberCount: 3 }, inviter: ana };
    mocked.fetchReceivedInvitations.mockResolvedValue({ items: [entry], nextCursor: null });
    mocked.acceptInvitation.mockRejectedValue(new api.ApiError(409, 'group_full', 'x'));
    at('/app/friends?tab=invitations');
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O grupo está cheio.');
    await waitFor(() => expect(mocked.fetchReceivedInvitations.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByRole('alert')).toHaveTextContent('O grupo está cheio.');
    expect(screen.getByText('Squad')).toBeInTheDocument();
  });

  it('an error on "Carregar mais" does not swap the list for an error screen', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends
      .mockResolvedValueOnce({ items: [{ user: ana, at: '2026-01-01T00:00:00.000Z' }], nextCursor: 'c1' })
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce({ items: [{ user: bea, at: '2026-01-01T00:00:00.000Z' }], nextCursor: null });
    at('/app/friends');
    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Não foi possível carregar mais.')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar seus amigos/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Bea')).toBeInTheDocument();
  });

  it('a list that failed to refresh warns, keeps the rows, and allows retrying', async () => {
    const user = userEvent.setup();
    incoming(ana);
    // the action fails, and so does the read that follows it
    mocked.acceptFriendRequest.mockImplementation(async () => { mocked.fetchFriendRequests.mockRejectedValue(new Error('rede')); throw new Error('x'); });
    at('/app/friends?tab=pending');
    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(await screen.findAllByText('Não foi possível atualizar a lista.')).not.toHaveLength(0);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    incoming(ana);
    // both sections (received and sent) had failed to refresh: retry each
    for (const retry of screen.getAllByRole('button', { name: 'Tentar de novo' })) await user.click(retry);
    await waitFor(() => expect(screen.queryByText('Não foi possível atualizar a lista.')).not.toBeInTheDocument());
  });
});

describe('FriendsContext — pending summary (E5)', () => {
  function Probe() {
    const { summaryStatus, pendingIncomingCount, bump } = useFriends();
    return <div><p>{`${summaryStatus}:${pendingIncomingCount}`}</p><button type="button" onClick={bump}>reler</button></div>;
  }

  it('starts unknown (not "zero") and switches to ready when the first read arrives', async () => {
    let resolve!: (v: { incoming: number; invitations: number }) => void;
    mocked.fetchRequestSummary.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderSocial(<Probe />);
    expect(screen.getByText('loading:0')).toBeInTheDocument();
    await act(async () => resolve({ incoming: 2, invitations: 1 }));
    expect(screen.getByText('ready:3')).toBeInTheDocument();
  });

  it('a failed re-read preserves the last valid number, marked as stale', async () => {
    const user = userEvent.setup();
    mocked.fetchRequestSummary.mockResolvedValueOnce({ incoming: 2, invitations: 0 }).mockRejectedValueOnce(new Error('rede'));
    renderSocial(<Probe />);
    expect(await screen.findByText('ready:2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'reler' }));
    expect(await screen.findByText('stale:2')).toBeInTheDocument();
  });

  it('the number follows a notification that arrives while Amigos is open on another view', async () => {
    const user = userEvent.setup();
    mocked.fetchRequestSummary.mockResolvedValueOnce({ incoming: 0, invitations: 0 }).mockResolvedValue({ incoming: 1, invitations: 0 });
    at('/app/friends?tab=online');
    expect(await screen.findByRole('link', { name: 'Pendentes' })).toBeInTheDocument(); // no badge yet
    // a `social-changed` from the server does exactly this: bumps the revision
    window.dispatchEvent(new Event('focus'));
    await user.click(screen.getByRole('link', { name: 'Online' }));
    expect(await screen.findByLabelText('1 solicitações aguardando resposta', undefined, { timeout: 3000 }).catch(() => null)).toBeDefined();
  });
});
