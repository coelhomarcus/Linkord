import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderAdmin, adminRoom, auditRow } from './adminFixture';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { UserDetailPage } from '@/features/admin/UserDetailPage';
import * as adminApi from '@/features/admin/adminApi';
import { ApiError } from '@/shared/api/api';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const detail = (over: Partial<adminApi.AdminUserDetail['user']> = {}): adminApi.AdminUserDetail => ({
  user: { id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', email: 'ana@example.com', statusReason: '', statusChangedAt: null, ...over },
  groups: [{ id: 'g1', title: 'Squad', status: 'active', role: 'owner' }],
  storage: { bytes: 2048, files: 2 },
  history: [auditRow()],
});
const open = (room = adminRoom(), tab = '') => renderAdmin(<UserDetailPage />, { path: `/admin/users/u1${tab ? `?tab=${tab}` : ''}`, pattern: '/admin/users/:id', room });
const openModeration = (room = adminRoom()) => open(room, 'moderation');

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminUser.mockResolvedValue(detail());
  mocked.fetchAudit.mockResolvedValue({ items: [auditRow()], nextCursor: null });
});

describe('UserDetailPage', () => {
  it('overview shows email, storage and state, with the id in the header', async () => {
    open();
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText(/2.0 KB em 2 arquivo/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });

  it('the groups tab lists the groups with the role of the account in each', async () => {
    open(adminRoom(), 'groups');
    expect(await screen.findByRole('link', { name: 'Squad' })).toHaveAttribute('href', '/admin/groups/g1');
    expect(screen.getByText('Dona do grupo')).toBeInTheDocument();
  });

  it('the history tab reads the complete history by target, with a cursor', async () => {
    const u = userEvent.setup();
    mocked.fetchAudit.mockResolvedValueOnce({ items: [auditRow()], nextCursor: 'c2' }).mockResolvedValue({ items: [auditRow({ id: 'a2', action: 'user.reactivate' })], nextCursor: null });
    open(adminRoom(), 'history');
    expect(await screen.findByText('Conta suspensa')).toBeInTheDocument();
    expect(screen.getByText('“spam em massa”')).toBeInTheDocument();
    expect(mocked.fetchAudit).toHaveBeenCalledWith({ targetType: 'user', targetId: 'u1' }, null);
    await u.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Conta reativada')).toBeInTheDocument();
    expect(mocked.fetchAudit).toHaveBeenLastCalledWith({ targetType: 'user', targetId: 'u1' }, 'c2');
  });

  it('the tabs are links with their own URL, the current one marked', async () => {
    open();
    await screen.findByText('ana@example.com');
    expect(screen.getByRole('link', { name: 'Resumo' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Moderação' })).toHaveAttribute('href', '/admin/users/u1?tab=moderation');
    expect(screen.getByRole('link', { name: 'Grupos (1)' })).toHaveAttribute('href', '/admin/users/u1?tab=groups');
  });

  it('only the open tab mounts: moderation actions are not on the overview', async () => {
    const u = userEvent.setup();
    open();
    await screen.findByText('ana@example.com');
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
    await u.click(screen.getByRole('link', { name: 'Moderação' }));
    expect(await screen.findByRole('button', { name: 'Suspender' })).toBeInTheDocument();
    expect(mocked.fetchAudit).not.toHaveBeenCalled();
  });

  it('an unknown tab in the URL falls back to the overview', async () => {
    open(adminRoom(), 'banana');
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
  });

  it('suspending requires a reason, sends it, and reloads', async () => {
    const u = userEvent.setup();
    mocked.suspendUser.mockResolvedValue({ ok: true });
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Suspender' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('button:disabled')).not.toBeNull();
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed spam');
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    await waitFor(() => expect(mocked.suspendUser).toHaveBeenCalledWith('u1', 'confirmed spam'));
    await waitFor(() => expect(mocked.fetchAdminUser).toHaveBeenCalledTimes(2));
  });

  it('suspended account offers Reactivate (and not Suspend)', async () => {
    mocked.fetchAdminUser.mockResolvedValue(detail({ status: 'suspended', statusReason: 'abuso', statusChangedAt: '2026-01-02T00:00:00.000Z' }));
    openModeration();
    expect(await screen.findByRole('button', { name: 'Reativar conta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
    expect(screen.getByText(/“abuso”/)).toBeInTheDocument();
  });

  it('deleting asks for the username to be typed, and only then calls the API', async () => {
    const u = userEvent.setup();
    mocked.deleteUser.mockResolvedValue({ ok: true });
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Excluir conta' }));
    await u.type(screen.getByLabelText(/Motivo/), 'requested by the account holder');
    const confirm = screen.getByRole('button', { name: 'Excluir para sempre' });
    expect(confirm).toBeDisabled();
    await u.type(screen.getByLabelText(/Para confirmar/), 'ana');
    await u.click(confirm);
    await waitFor(() => expect(mocked.deleteUser).toHaveBeenCalledWith('u1', 'requested by the account holder', 'ana'));
    expect(await screen.findByText(/Conta excluída/)).toBeInTheDocument();
  });

  it('on your own account, suspend and delete stay disabled', async () => {
    openModeration(adminRoom('admin', 'u1'));
    expect(await screen.findByRole('button', { name: 'Suspender' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Excluir conta' })).toBeDisabled();
  });

  it('nonexistent account shows a warning, without crashing', async () => {
    mocked.fetchAdminUser.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    open();
    expect(await screen.findByText(/Conta não encontrada/)).toBeInTheDocument();
  });

  it('granting admin requires a reason and the username to be typed', async () => {
    const u = userEvent.setup();
    mocked.grantAdmin.mockResolvedValue({ ok: true });
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Conceder admin' }));
    await u.type(screen.getByLabelText(/Motivo/), 'second trusted person');
    const confirm = screen.getAllByRole('button', { name: 'Conceder admin' }).at(-1)!;
    expect(confirm).toBeDisabled();
    await u.type(screen.getByLabelText(/Para confirmar/), 'ana');
    await u.click(confirm);
    await waitFor(() => expect(mocked.grantAdmin).toHaveBeenCalledWith('u1', 'second trusted person'));
  });

  it('admin account offers Remove admin (disabled on your own)', async () => {
    mocked.fetchAdminUser.mockResolvedValue(detail({ role: 'admin' }));
    const { unmount } = openModeration();
    expect(await screen.findByRole('button', { name: 'Remover admin' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Conceder admin' })).not.toBeInTheDocument();
    unmount();

    openModeration(adminRoom('admin', 'u1'));
    expect(await screen.findByRole('button', { name: 'Remover admin' })).toBeDisabled();
  });

  it('suspended account cannot be granted admin', async () => {
    mocked.fetchAdminUser.mockResolvedValue(detail({ status: 'suspended', statusChangedAt: '2026-01-02T00:00:00.000Z' }));
    openModeration();
    expect(await screen.findByRole('button', { name: 'Conceder admin' })).toBeDisabled();
  });

  it('the last active admin shows the translated error', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminUser.mockResolvedValue(detail({ role: 'admin' }));
    mocked.revokeAdmin.mockRejectedValue(new ApiError(409, 'last_admin', 'x'));
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Remover admin' }));
    await u.type(screen.getByLabelText(/Motivo/), 'rotation');
    await u.type(screen.getByLabelText(/Para confirmar/), 'ana');
    await u.click(screen.getAllByRole('button', { name: 'Remover admin' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('último administrador ativo');
  });

  it('a mutation that succeeded but whose refresh failed says so, and retrying only re-reads', async () => {
    const u = userEvent.setup();
    mocked.suspendUser.mockResolvedValue({ ok: true });
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Suspender' }));
    mocked.fetchAdminUser.mockRejectedValueOnce(new Error('offline'));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed spam');
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);

    expect(await screen.findByText(/Ação concluída, mas não foi possível atualizar/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument();
    expect(mocked.suspendUser).toHaveBeenCalledTimes(1);

    mocked.fetchAdminUser.mockResolvedValue(detail({ status: 'suspended', statusChangedAt: '2026-01-02T00:00:00.000Z' }));
    await u.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('button', { name: 'Reativar conta' })).toBeInTheDocument();
    expect(mocked.suspendUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Ação concluída, mas/)).not.toBeInTheDocument();
  });

  it('on your own account every unavailable action says why', async () => {
    openModeration(adminRoom('admin', 'u1'));
    expect(await screen.findByText('Você não pode suspender a própria conta.')).toBeInTheDocument();
    expect(screen.getByText('Você não pode excluir a própria conta.')).toBeInTheDocument();
    expect(screen.getByText(/encerra a sua própria sessão/)).toBeInTheDocument();
  });

  it('deleting sits apart, in its own danger section, with the real effect spelled out', async () => {
    openModeration();
    const danger = (await screen.findByRole('heading', { name: 'Zona de perigo' })).closest('section')!;
    expect(danger).toHaveTextContent('passam ao membro mais antigo');
    expect(danger).toHaveTextContent('As mensagens já enviadas continuam no histórico');
    expect(danger.querySelectorAll('button')).toHaveLength(1);
  });

  it('revoking ANOTHER account\'s sessions re-reads the account', async () => {
    const u = userEvent.setup();
    mocked.revokeUserSessions.mockResolvedValue({ ok: true });
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Revogar sessões' }));
    await u.type(screen.getByLabelText(/Motivo/), 'stolen device');
    await u.click(screen.getAllByRole('button', { name: 'Revogar' }).at(-1)!);
    await waitFor(() => expect(mocked.revokeUserSessions).toHaveBeenCalledWith('u1', 'stolen device'));
    await waitFor(() => expect(mocked.fetchAdminUser).toHaveBeenCalledTimes(2));
  });

  it('revoking your OWN sessions ends this session: say so instead of re-reading into a 401', async () => {
    const u = userEvent.setup();
    mocked.revokeUserSessions.mockResolvedValue({ ok: true });
    openModeration(adminRoom('admin', 'u1'));
    await u.click(await screen.findByRole('button', { name: 'Revogar sessões' }));
    await u.type(screen.getByLabelText(/Motivo/), 'testing logout');
    await u.click(screen.getAllByRole('button', { name: 'Revogar' }).at(-1)!);
    expect(await screen.findByRole('status')).toHaveTextContent('Suas sessões foram encerradas');
    expect(mocked.fetchAdminUser).toHaveBeenCalledTimes(1);
  });

  it('the list the admin came from travels through the tabs, so "back" still returns to its query', async () => {
    const u = userEvent.setup();
    renderWithRoom(
      <MemoryRouter initialEntries={[{ pathname: '/admin/users/u1', state: { from: '/admin/users?status=suspended' } }]}>
        <Routes><Route path="/admin/users/:id" element={<UserDetailPage />} /></Routes>
      </MemoryRouter>,
      adminRoom(),
    );
    await screen.findByText('ana@example.com');
    await u.click(screen.getByRole('link', { name: 'Moderação' }));
    await screen.findByRole('button', { name: 'Suspender' });
    expect(screen.getByRole('link', { name: '← Usuários' })).toHaveAttribute('href', '/admin/users?status=suspended');
  });

  it('suspending an account somebody else already suspended explains it and re-reads', async () => {
    const u = userEvent.setup();
    mocked.suspendUser.mockRejectedValue(new ApiError(409, 'already_suspended', 'x'));
    openModeration();
    await u.click(await screen.findByRole('button', { name: 'Suspender' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed spam');
    mocked.fetchAdminUser.mockResolvedValue(detail({ status: 'suspended', statusReason: 'outro admin', statusChangedAt: '2026-01-02T00:00:00.000Z' }));
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Já estava suspenso');
    await waitFor(() => expect(mocked.fetchAdminUser).toHaveBeenCalledTimes(2));
  });
});
