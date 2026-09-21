import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { UsersPage } from '@/features/admin/UsersPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);
const user = (over: Partial<adminApi.AdminUserRow> = {}): adminApi.AdminUserRow => ({
  id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminUsers.mockResolvedValue({ items: [user(), user({ id: 'u2', username: 'bia', displayName: 'Bia', status: 'suspended', role: 'admin' })], nextCursor: null });
});

describe('UsersPage', () => {
  it('lista contas com situacao e papel, cada uma levando ao detalhe', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    const link = await screen.findByRole('link', { name: /Ana/ });
    expect(link).toHaveAttribute('href', '/admin/users/u1');
    expect(screen.getByText('Suspenso')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(mocked.fetchAdminUsers).toHaveBeenCalledWith({ q: '', status: undefined, role: undefined }, null);
  });

  it('os filtros de situacao e papel chegam ao servidor', async () => {
    const u = userEvent.setup();
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    await screen.findByText('Ana');
    await u.click(screen.getByRole('button', { name: 'Suspensos' }));
    await waitFor(() => expect(mocked.fetchAdminUsers).toHaveBeenLastCalledWith({ q: '', status: 'suspended', role: undefined }, null));
    await u.click(screen.getByRole('button', { name: 'Admins' }));
    await waitFor(() => expect(mocked.fetchAdminUsers).toHaveBeenLastCalledWith({ q: '', status: 'suspended', role: 'admin' }, null));
  });

  it('busca por texto e paginacao por cursor', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminUsers.mockResolvedValueOnce({ items: [user()], nextCursor: 'c2' }).mockResolvedValue({ items: [user({ id: 'u3', username: 'caio', displayName: 'Caio' })], nextCursor: null });
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    await u.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(mocked.fetchAdminUsers).toHaveBeenLastCalledWith({ q: '', status: undefined, role: undefined }, 'c2');
    expect(await screen.findByText('Caio')).toBeInTheDocument();

    await u.type(screen.getByLabelText('Buscar usuários'), 'ca');
    await waitFor(() => expect(mocked.fetchAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ca' }), null));
  });

  it('erro oferece nova tentativa', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminUsers.mockRejectedValueOnce(new Error('x'));
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    await u.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });
});
