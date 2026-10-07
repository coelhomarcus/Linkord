import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { UsersPage } from '@/features/admin/UsersPage';
import { GroupsPage } from '@/features/admin/GroupsPage';
import { dayStartIso, nextDayStartIso } from '@/features/admin/adminFormat';
import { useAdminMode } from '@/features/admin/useAdminMode';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/useAdminMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminMode')>()),
  useAdminMode: vi.fn(() => 'wide'),
}));
const mocked = vi.mocked(adminApi);

const user = (over: Partial<adminApi.AdminUserRow> = {}): adminApi.AdminUserRow => ({
  id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const group = (over: Partial<adminApi.AdminGroupRow> = {}): adminApi.AdminGroupRow => ({
  id: 'g1', title: 'Squad', avatar: '', status: 'active', memberCount: 3, ownerId: 'u1', ownerUsername: 'ana', createdBy: 'u1', createdAt: '2026-01-01T00:00:00.000Z', lastMessageAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminMode).mockReturnValue('wide');
  mocked.fetchAdminUsers.mockResolvedValue({ items: [user(), user({ id: 'u2', username: 'bia', displayName: 'Bia', role: 'admin', status: 'suspended' })], nextCursor: null });
  mocked.fetchAdminGroups.mockResolvedValue({ items: [group(), group({ id: 'g2', title: '', ownerId: null, ownerUsername: null, status: 'suspended', memberCount: 1 })], nextCursor: null });
});

describe('UsersPage layout', () => {
  it('wide: a real table with a column per attribute and a count of what is loaded', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    const table = await screen.findByRole('table', { name: 'Contas' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Usuário', 'Situação', 'Papel', 'Criada em', 'Ações']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('2 contas carregadas')).toBeInTheDocument();
  });

  it('compact: stacked rows only — the table is not mounted alongside', async () => {
    vi.mocked(useAdminMode).mockReturnValue('compact');
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Ana.*@ana/ })).toHaveAttribute('href', '/admin/users/u1');
  });

  it('copy and history are separate controls from the row link', async () => {
    const u = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    await u.click(await screen.findByRole('button', { name: 'Copiar ID de Ana' }));
    expect(writeText).toHaveBeenCalledWith('u1');
    expect(await screen.findByRole('button', { name: 'ID copiado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver histórico de Ana' })).toHaveAttribute('href', '/admin/audit?targetId=u1');
    expect(screen.getByRole('link', { name: /Ana.*@ana/ }).querySelector('button')).toBeNull();
  });

  it('the period keeps "up to" inclusive: the server gets the start of the NEXT day', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users?from=2026-03-01&to=2026-03-31', pattern: '/admin/users' });
    await screen.findByRole('table');
    expect(mocked.fetchAdminUsers).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date(2026, 2, 1).toISOString(),
      to: new Date(2026, 3, 1).toISOString(),
    }), null);
    // the period is active, so its fields are visible without opening anything
    expect(screen.getByLabelText('Criada a partir de')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('Criada até')).toHaveValue('2026-03-31');
  });

  it('the period fields stay folded until asked for, then write to the URL', async () => {
    const u = userEvent.setup();
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Criada até')).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Mais filtros/ }));
    await u.type(screen.getByLabelText('Criada até'), '2026-03-31');
    await waitFor(() => expect(mocked.fetchAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ to: nextDayStartIso('2026-03-31') }), null));
  });

  it('searching mentions the id as a supported key', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users', pattern: '/admin/users' });
    expect(await screen.findByPlaceholderText('Buscar por nome, usuário ou ID')).toBeInTheDocument();
  });
});

describe('GroupsPage layout', () => {
  it('wide: table with owner and member columns; "no owner" is its own mark, apart from the suspension', async () => {
    renderAdmin(<GroupsPage />, { path: '/admin/groups', pattern: '/admin/groups' });
    const table = await screen.findByRole('table', { name: 'Grupos' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Grupo', 'Situação', 'Dono', 'Membros', 'Criado em', 'Ações']);
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByRole('link', { name: '@ana' })).toHaveAttribute('href', '/admin/users/u1');
    expect(within(rows[2]!).getByText('Sem dono')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Suspenso')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Grupo sem nome')).toBeInTheDocument();
    expect(screen.getByText('2 grupos carregados')).toBeInTheDocument();
  });

  it('compact: stacked rows only, still showing owner, members and date', async () => {
    vi.mocked(useAdminMode).mockReturnValue('compact');
    renderAdmin(<GroupsPage />, { path: '/admin/groups', pattern: '/admin/groups' });
    expect(await screen.findByText('Squad')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('3 membros')).toBeInTheDocument();
    expect(screen.getByText('1 membro')).toBeInTheDocument();
  });

  it('the "no owner" filter reaches the server as the orphan flag', async () => {
    renderAdmin(<GroupsPage />, { path: '/admin/groups?filter=orphan', pattern: '/admin/groups' });
    await screen.findByRole('table');
    expect(mocked.fetchAdminGroups).toHaveBeenCalledWith({ q: '', status: undefined, orphan: true }, null);
  });
});

describe('day helpers', () => {
  it('reject anything that is not a plain date', () => {
    expect(dayStartIso('2026-13-45')).toBeUndefined();
    expect(dayStartIso('2026-02-31')).toBeUndefined();
    expect(dayStartIso('garbage')).toBeUndefined();
    expect(nextDayStartIso('2026-12-31')).toBe(new Date(2027, 0, 1).toISOString());
    expect(nextDayStartIso('')).toBeUndefined();
  });
});
