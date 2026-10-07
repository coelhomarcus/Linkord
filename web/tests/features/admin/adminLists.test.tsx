import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { adminRoom, renderAdmin } from './adminFixture';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { UsersPage } from '@/features/admin/UsersPage';
import { UserDetailPage } from '@/features/admin/UserDetailPage';
import { AuditPage } from '@/features/admin/AuditPage';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { ListChrome } from '@/features/admin/adminUi';
import * as adminApi from '@/features/admin/adminApi';
import { invalidateAdminLists } from '@/features/admin/adminListCache';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const user = (over: Partial<adminApi.AdminUserRow> = {}): adminApi.AdminUserRow => ({
  id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

function Where() {
  const { pathname, search } = useLocation();
  return <output aria-label="location">{pathname}{search}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAdminLists();
  mocked.fetchAdminUsers.mockResolvedValue({ items: [user()], nextCursor: null });
  mocked.fetchAdminUser.mockResolvedValue({
    user: { ...user(), email: 'ana@example.com', statusReason: '', statusChangedAt: null },
    groups: [], storage: { bytes: 0, files: 0 }, history: [],
  });
});

describe('filters live in the URL', () => {
  it('a link with filters opens the list already filtered', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users?status=suspended&role=admin&q=bia', pattern: '/admin/users' });
    await screen.findByText('Ana');
    expect(mocked.fetchAdminUsers).toHaveBeenCalledWith({ q: 'bia', status: 'suspended', role: 'admin' }, null);
    expect(screen.getByLabelText('Buscar usuários')).toHaveValue('bia');
    expect(screen.getByLabelText('Situação')).toHaveValue('suspended');
    expect(screen.getByLabelText('Papel')).toHaveValue('admin');
  });

  it('an unknown filter value in the URL is ignored instead of breaking the list', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users?status=banana', pattern: '/admin/users' });
    await screen.findByText('Ana');
    expect(mocked.fetchAdminUsers).toHaveBeenCalledWith({ q: '', status: undefined, role: undefined }, null);
  });

  it('clicking a filter writes it to the URL, and the empty state offers to clear them', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminUsers.mockResolvedValue({ items: [], nextCursor: null });
    renderWithRoom(
      <MemoryRouter initialEntries={['/admin/users']}><Routes><Route path="/admin/users" element={<><UsersPage /><Where /></>} /></Routes></MemoryRouter>,
      adminRoom(),
    );
    await screen.findByText('Nenhuma conta encontrada.');
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Situação'), 'suspended');
    expect(screen.getByLabelText('location')).toHaveTextContent('/admin/users?status=suspended');
    await u.click(await screen.findByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/admin\/users$/);
  });

  it('a search containing a pipe reaches the server intact (no joined-string identity)', async () => {
    const u = userEvent.setup();
    mocked.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
    renderAdmin(<AuditPage />, { path: '/admin/audit', pattern: '/admin/audit' });
    await screen.findByText('Nenhum registro para esses filtros.');
    await u.type(screen.getByLabelText('Ator'), 'a|b');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'a|b', action: '', targetId: '' }), null));
  });

  it('the reports queue is in the URL too', async () => {
    mocked.fetchAdminReports.mockResolvedValue({ items: [], nextCursor: null });
    renderAdmin(<ReportsPage />, { path: '/admin/reports?status=reviewing', pattern: '/admin/reports' });
    await screen.findByText('Nenhuma denúncia nesta fila.');
    expect(mocked.fetchAdminReports).toHaveBeenCalledWith({ status: 'reviewing' }, null);
  });
});

describe('back from a detail', () => {
  function app(initial: string) {
    return renderWithRoom(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/users/:id" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>,
      adminRoom(),
    );
  }

  it('returns to the exact query the admin came from', async () => {
    const u = userEvent.setup();
    app('/admin/users?status=suspended&q=ana');
    await u.click(await screen.findByRole('link', { name: /Ana.*@ana/ }));
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Usuários' })).toHaveAttribute('href', '/admin/users?status=suspended&q=ana');
  });

  it('a direct access falls back to the plain list', async () => {
    renderWithRoom(
      <MemoryRouter initialEntries={[{ pathname: '/admin/users/u1', state: { from: 'https://evil.example/x' } }]}>
        <Routes><Route path="/admin/users/:id" element={<UserDetailPage />} /></Routes>
      </MemoryRouter>,
      adminRoom(),
    );
    expect(await screen.findByRole('link', { name: '← Usuários' })).toHaveAttribute('href', '/admin/users');
  });
});

describe('list states', () => {
  const base = { status: 'ready' as const, items: [1], hasMore: false, loadingMore: false, loadMoreError: false, refreshing: false, stale: false, loadMore: vi.fn(), retry: vi.fn() };

  it('a failed next page keeps the rows and offers to try again', async () => {
    const u = userEvent.setup();
    const loadMore = vi.fn();
    render(<ListChrome list={{ ...base, hasMore: true, loadMoreError: true, loadMore }} empty="vazio"><p>linha 1</p></ListChrome>);
    expect(screen.getByText('linha 1')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar mais.');
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('a failed re-read marks the rows as out of date, without removing them', async () => {
    const u = userEvent.setup();
    const retry = vi.fn();
    render(<ListChrome list={{ ...base, stale: true, retry }} empty="vazio"><p>linha 1</p></ListChrome>);
    expect(screen.getByText('linha 1')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('desatualizados');
    await u.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
