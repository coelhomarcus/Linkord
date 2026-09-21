import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const open = () => renderAdmin(<GroupDetailPage />, { path: '/admin/groups/g1', pattern: '/admin/groups/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminGroup.mockResolvedValue(detail());
});

describe('GroupDetailPage', () => {
  it('mostra dono e membros, sem nenhuma forma de abrir a conversa', async () => {
    open();
    expect((await screen.findAllByText('@ana')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /BIA/ })).toHaveAttribute('href', '/admin/users/bia');
    expect(screen.queryByRole('link', { name: /entrar|abrir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /entrar|abrir/i })).not.toBeInTheDocument();
  });

  it('suspender pede motivo e chama a API do grupo', async () => {
    const u = userEvent.setup();
    mocked.suspendGroup.mockResolvedValue({ ok: true });
    open();
    await u.click(await screen.findByRole('button', { name: 'Suspender grupo' }));
    await u.type(screen.getByLabelText(/Motivo/), 'denúncia procedente');
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    await waitFor(() => expect(mocked.suspendGroup).toHaveBeenCalledWith('g1', 'denúncia procedente'));
  });

  it('grupo sem dono: admin atribui a um membro, com motivo', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminGroup.mockResolvedValue(detail({}, false));
    mocked.assignGroupOwner.mockResolvedValue({ ok: true });
    open();
    expect(await screen.findByText(/nenhum \(grupo sem dono\)/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Tornar dono' }));
    await u.type(screen.getByLabelText(/Motivo/), 'recuperação');
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    await waitFor(() => expect(mocked.assignGroupOwner).toHaveBeenCalledWith('g1', 'bia', 'recuperação'));
  });

  it('grupo suspenso oferece Reativar e mostra o motivo', async () => {
    mocked.fetchAdminGroup.mockResolvedValue(detail({ status: 'suspended', statusReason: 'conteúdo ilegal' }));
    open();
    expect(await screen.findByRole('button', { name: 'Reativar grupo' })).toBeInTheDocument();
    expect(screen.getByText('conteúdo ilegal')).toBeInTheDocument();
  });

  it('excluir exige o nome do grupo digitado', async () => {
    const u = userEvent.setup();
    mocked.deleteGroup.mockResolvedValue({ ok: true });
    open();
    await u.click(await screen.findByRole('button', { name: 'Excluir grupo' }));
    await u.type(screen.getByLabelText(/Motivo/), 'ilegal');
    expect(screen.getByRole('button', { name: 'Excluir para sempre' })).toBeDisabled();
    await u.type(screen.getByLabelText(/Para confirmar/), 'Squad');
    await u.click(screen.getByRole('button', { name: 'Excluir para sempre' }));
    await waitFor(() => expect(mocked.deleteGroup).toHaveBeenCalledWith('g1', 'ilegal'));
  });
});
