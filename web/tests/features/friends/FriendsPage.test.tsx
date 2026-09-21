import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial, ana, bea } from '@tests/fixtures/socialFixture';
import { FriendsPage } from '@/features/friends/FriendsPage';
import * as api from '@/shared/api/api';

vi.mock('@/shared/PageHeader', () => ({ PageHeader: ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (<header><h1>{title}</h1><p>{subtitle}</p>{actions}</header>) }));
vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriends: vi.fn(), fetchRequestSummary: vi.fn(), sendFriendRequest: vi.fn(), removeFriend: vi.fn(), blockUser: vi.fn(),
}));
const mocked = vi.mocked(api);

const me = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };
const page = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
});

describe('FriendsPage', () => {
  it('lista os amigos vindos do servidor, com contagem', async () => {
    mocked.fetchFriends.mockResolvedValue(page(ana, bea));
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    expect(screen.getByText('2 amigos')).toBeInTheDocument();
  });

  it('conta nova: estado vazio convida a adicionar e oferece copiar o proprio @username', async () => {
    mocked.fetchFriends.mockResolvedValue(page());
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    expect(await screen.findByText('Adicione amigos para começar uma conversa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar @fulana' })).toBeInTheDocument();
    // an empty list must not look like a connection error
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
  });

  it('falha ao carregar mostra erro com "Tentar de novo" (e recarrega)', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(page(ana));
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });

  it('filtro Online mostra so quem esta online entre os carregados', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockResolvedValue(page(ana, bea));
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me, onlineUserIds: new Set(['u-ana']) } });

    await screen.findByText('Bea');
    await user.click(screen.getByRole('button', { name: 'Online' }));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bea')).not.toBeInTheDocument();
  });

  it('adicionar por @username normaliza o texto e mostra o resultado', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockResolvedValue(page(ana));
    mocked.sendFriendRequest.mockResolvedValue('created');
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Adicionar amigo' }));
    await user.type(screen.getByPlaceholderText('@nomedeusuario'), '  @Lune ');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(mocked.sendFriendRequest).toHaveBeenCalledWith('Lune');
    expect(await screen.findByText('Solicitação enviada para @Lune.')).toBeInTheDocument();
  });

  it('erro generico do servidor nao revela se a conta existe ou bloqueou', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockResolvedValue(page(ana));
    mocked.sendFriendRequest.mockRejectedValue(new api.ApiError(404, 'user_unavailable', 'x'));
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Adicionar amigo' }));
    await user.type(screen.getByPlaceholderText('@nomedeusuario'), 'ninguem');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Confira o nome de usuário/)).toBeInTheDocument();
  });

  it('remover amizade pede confirmacao e depois refaz a lista', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockResolvedValueOnce(page(ana)).mockResolvedValueOnce(page());
    mocked.removeFriend.mockResolvedValue({});
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Mais ações para Ana' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover amizade' }));
    expect(mocked.removeFriend).not.toHaveBeenCalled(); // not before confirming
    await user.click(await screen.findByRole('button', { name: 'Remover' }));

    expect(mocked.removeFriend).toHaveBeenCalledWith('u-ana');
    await waitFor(() => expect(mocked.fetchFriends).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Adicione amigos para começar uma conversa')).toBeInTheDocument();
  });

  it('bloquear explica o efeito antes de confirmar', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockResolvedValue(page(ana));
    renderSocial(<FriendsPage onOpenProfile={vi.fn()} />, { room: { state: me } });

    await screen.findByText('Ana');
    await user.click(screen.getByRole('button', { name: 'Mais ações para Ana' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Bloquear' }));
    expect(await screen.findByText(/não restaura a amizade/)).toBeInTheDocument();
  });
});
