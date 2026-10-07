import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api/api';
import { renderAdmin } from './adminFixture';
import { GroupDetailPage } from '@/features/admin/GroupDetailPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const member = (id: string, role: 'owner' | 'member'): adminApi.AdminGroupMember => ({
  user: { id, username: id, displayName: id.toUpperCase(), avatar: '', avatarColor: 'green' }, role, at: '2026-01-01T00:00:00.000Z',
});
const detail = (over: Partial<adminApi.AdminGroupDetail['group']> = {}, owner = true): adminApi.AdminGroupDetail => ({
  group: { id: 'g1', title: 'Squad', avatar: '', status: 'active', memberCount: 2, ownerId: owner ? 'ana' : null, ownerUsername: owner ? 'ana' : null, createdBy: 'ana', createdAt: '2026-01-01T00:00:00.000Z', lastMessageAt: null, statusReason: '', ...over },
  members: { items: owner ? [member('ana', 'owner'), member('bia', 'member')] : [member('bia', 'member')], nextCursor: null },
  history: [],
});
const open = (tab = '') => renderAdmin(<GroupDetailPage />, { path: `/admin/groups/g1${tab ? `?tab=${tab}` : ''}`, pattern: '/admin/groups/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminGroup.mockResolvedValue(detail());
  mocked.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
});

describe('GroupDetailPage', () => {
  it('shows owner and members, with no way to open the conversation', async () => {
    open('members');
    expect((await screen.findAllByText('@ana')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /BIA/ })).toHaveAttribute('href', '/admin/users/bia');
    expect(screen.queryByRole('link', { name: /entrar|abrir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /entrar|abrir/i })).not.toBeInTheDocument();
  });

  it('suspending asks for a reason and calls the group API', async () => {
    const u = userEvent.setup();
    mocked.suspendGroup.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Suspender grupo' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed report');
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    await waitFor(() => expect(mocked.suspendGroup).toHaveBeenCalledWith('g1', 'confirmed report'));
  });

  it('group with no owner: admin assigns one to a member, with a reason', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminGroup.mockResolvedValue(detail({}, false));
    mocked.assignGroupOwner.mockResolvedValue({ ok: true });
    open('members');
    expect(await screen.findByRole('button', { name: 'Atribuir dono' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Atribuir dono' }));
    await u.type(screen.getByLabelText(/Motivo/), 'recovery');
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    await waitFor(() => expect(mocked.assignGroupOwner).toHaveBeenCalledWith('g1', 'bia', 'recovery'));
  });

  it('suspended group offers Reactivate and shows the reason', async () => {
    mocked.fetchAdminGroup.mockResolvedValue(detail({ status: 'suspended', statusReason: 'conteúdo ilegal' }));
    open('moderation');
    expect(await screen.findByRole('button', { name: 'Reativar grupo' })).toBeInTheDocument();
    expect(screen.getAllByText(/conteúdo ilegal/).length).toBeGreaterThan(0);
  });

  it('deleting requires the group name to be typed in', async () => {
    const u = userEvent.setup();
    mocked.deleteGroup.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Excluir grupo' }));
    await u.type(screen.getByLabelText(/Motivo/), 'illegal');
    expect(screen.getByRole('button', { name: 'Excluir para sempre' })).toBeDisabled();
    await u.type(screen.getByLabelText(/Para confirmar/), 'Squad');
    await u.click(screen.getByRole('button', { name: 'Excluir para sempre' }));
    await waitFor(() => expect(mocked.deleteGroup).toHaveBeenCalledWith('g1', 'illegal'));
  });

  it('a failed "load more" keeps the members already shown and offers to try again', async () => {
    const u = userEvent.setup();
    const first = detail();
    first.members.nextCursor = 'c1';
    mocked.fetchAdminGroup.mockResolvedValueOnce(first);
    open('members');
    expect(await screen.findByRole('link', { name: /BIA/ })).toBeInTheDocument();

    mocked.fetchAdminGroup.mockRejectedValueOnce(new Error('offline'));
    await u.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Não foi possível carregar mais membros.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /BIA/ })).toBeInTheDocument();

    mocked.fetchAdminGroup.mockResolvedValueOnce({ ...detail(), members: { items: [member('cai', 'member')], nextCursor: null } });
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('link', { name: /CAI/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /BIA/ })).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar mais membros.')).not.toBeInTheDocument();
    expect(mocked.fetchAdminGroup).toHaveBeenLastCalledWith('g1', 'c1');
  });

  it('overview shows who owns the group (a group with no owner says so), with the id in the header', async () => {
    const { unmount } = open();
    expect(await screen.findByRole('link', { name: '@ana' })).toHaveAttribute('href', '/admin/users/ana');
    expect(screen.getByRole('heading', { name: 'Squad' })).toBeInTheDocument();
    expect(screen.getByText('g1')).toBeInTheDocument();
    unmount();

    mocked.fetchAdminGroup.mockResolvedValue(detail({}, false));
    open();
    expect(await screen.findByText('nenhum (grupo sem dono)')).toBeInTheDocument();
    expect(screen.getByText('Sem dono')).toBeInTheDocument();
  });

  it('the owner dialog names the current and the new owner, and nothing changes until the server confirms', async () => {
    const u = userEvent.setup();
    let confirm!: () => void;
    mocked.assignGroupOwner.mockImplementation(() => new Promise((resolve) => { confirm = () => resolve({ ok: true }); }));
    open('members');
    await u.click(await screen.findByRole('button', { name: 'Atribuir dono' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Dono atual: @ana. Novo dono: @bia.');
    await u.type(screen.getByLabelText(/Motivo/), 'owner left the platform');
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(mocked.fetchAdminGroup).toHaveBeenCalledTimes(1);
    confirm();
    await waitFor(() => expect(mocked.fetchAdminGroup).toHaveBeenCalledTimes(2));
  });

  it('a member who left while the dialog was open: explains, and refreshes the members', async () => {
    const u = userEvent.setup();
    mocked.assignGroupOwner.mockRejectedValue(new ApiError(409, 'not_member', 'x'));
    open('members');
    await u.click(await screen.findByRole('button', { name: 'Atribuir dono' }));
    await u.type(screen.getByLabelText(/Motivo/), 'recovery');
    mocked.fetchAdminGroup.mockResolvedValue({ ...detail(), members: { items: [member('ana', 'owner')], nextCursor: null } });
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não é mais membro do grupo');
    await waitFor(() => expect(mocked.fetchAdminGroup).toHaveBeenCalledTimes(2));
  });

  it('suspending a group that was already suspended explains the conflict and catches the screen up', async () => {
    const u = userEvent.setup();
    mocked.suspendGroup.mockRejectedValue(new ApiError(409, 'already_suspended', 'x'));
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Suspender grupo' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed report');
    mocked.fetchAdminGroup.mockResolvedValue(detail({ status: 'suspended', statusReason: 'outro admin' }));
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Já estava suspenso');
    await waitFor(() => expect(mocked.fetchAdminGroup).toHaveBeenCalledTimes(2));
  });

  it('the history tab reads the group audit trail by target', async () => {
    mocked.fetchAudit.mockResolvedValue({ items: [{ id: 'a1', at: '2026-01-01T10:00:00.000Z', actorId: 'x', actorLabel: 'lune', action: 'group.suspend', targetType: 'group', targetId: 'g1', targetLabel: 'Squad', reason: 'abuso', result: 'ok', detail: {}, requestId: 'r' }], nextCursor: null });
    open('history');
    expect(await screen.findByText('Grupo suspenso')).toBeInTheDocument();
    expect(mocked.fetchAudit).toHaveBeenCalledWith({ targetType: 'group', targetId: 'g1' }, null);
  });

  it('tabs are links with their own URL; the admin never gets a way into the conversation', async () => {
    open();
    await screen.findByRole('heading', { name: 'Squad' });
    expect(screen.getByRole('link', { name: 'Membros (2)' })).toHaveAttribute('href', '/admin/groups/g1?tab=members');
    expect(screen.queryByRole('link', { name: /entrar|abrir/i })).not.toBeInTheDocument();
  });
});
