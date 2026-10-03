import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin, adminRoom, auditRow } from './adminFixture';
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
const open = (room = adminRoom()) => renderAdmin(<UserDetailPage />, { path: '/admin/users/u1', pattern: '/admin/users/:id', room });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminUser.mockResolvedValue(detail());
});

describe('UserDetailPage', () => {
  it('shows email, groups, storage and account history', async () => {
    open();
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Squad' })).toHaveAttribute('href', '/admin/groups/g1');
    expect(screen.getByText(/2.0 KB em 2 arquivo/)).toBeInTheDocument();
    expect(screen.getByText('Conta suspensa')).toBeInTheDocument();
    expect(screen.getByText('“spam em massa”')).toBeInTheDocument();
  });

  it('suspending requires a reason, sends it, and reloads', async () => {
    const u = userEvent.setup();
    mocked.suspendUser.mockResolvedValue({ ok: true });
    open();
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
    open();
    expect(await screen.findByRole('button', { name: 'Reativar conta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
    expect(screen.getByText(/“abuso”/)).toBeInTheDocument();
  });

  it('deleting asks for the username to be typed, and only then calls the API', async () => {
    const u = userEvent.setup();
    mocked.deleteUser.mockResolvedValue({ ok: true });
    open();
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
    open(adminRoom('admin', 'u1'));
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
    open();
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
    const { unmount } = open();
    expect(await screen.findByRole('button', { name: 'Remover admin' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Conceder admin' })).not.toBeInTheDocument();
    unmount();

    open(adminRoom('admin', 'u1'));
    expect(await screen.findByRole('button', { name: 'Remover admin' })).toBeDisabled();
  });

  it('suspended account cannot be granted admin', async () => {
    mocked.fetchAdminUser.mockResolvedValue(detail({ status: 'suspended', statusChangedAt: '2026-01-02T00:00:00.000Z' }));
    open();
    expect(await screen.findByRole('button', { name: 'Conceder admin' })).toBeDisabled();
  });

  it('the last active admin shows the translated error', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminUser.mockResolvedValue(detail({ role: 'admin' }));
    mocked.revokeAdmin.mockRejectedValue(new ApiError(409, 'last_admin', 'x'));
    open();
    await u.click(await screen.findByRole('button', { name: 'Remover admin' }));
    await u.type(screen.getByLabelText(/Motivo/), 'rotation');
    await u.type(screen.getByLabelText(/Para confirmar/), 'ana');
    await u.click(screen.getAllByRole('button', { name: 'Remover admin' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('último administrador ativo');
  });
});
