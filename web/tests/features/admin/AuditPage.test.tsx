import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin, auditRow } from './adminFixture';
import { AuditPage } from '@/features/admin/AuditPage';
import { useAdminTableFits } from '@/features/admin/useAdminMode';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/useAdminMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminMode')>()),
  useAdminTableFits: vi.fn(() => true),
}));
const mocked = vi.mocked(adminApi);

const open = (path = '/admin/audit') => renderAdmin(<AuditPage />, { path, pattern: '/admin/audit' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminTableFits).mockReturnValue(true);
  mocked.fetchAudit.mockResolvedValue({ items: [auditRow(), auditRow({ id: 'a2', action: 'user.delete', result: 'failed', targetId: 'u2', targetLabel: 'bia' })], nextCursor: null });
});

describe('AuditPage', () => {
  it('lists records in a table: when, action, administrator, target, result', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Registros de auditoria' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Quando', 'Ação', 'Administrador', 'Alvo', 'Resultado']);
    expect(within(table).getByText('Conta suspensa')).toBeInTheDocument();
    expect(within(table).getByText('Conta excluída')).toBeInTheDocument();
    expect(within(table).getByText('Concluída')).toBeInTheDocument();
    expect(within(table).getByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('2 registros carregados')).toBeInTheDocument();
  });

  it('administrator and target link to their admin pages — except the target of its own deletion', async () => {
    open();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('link', { name: 'lune' })[0]).toHaveAttribute('href', '/admin/users/admin-1');
    expect(within(table).getByRole('link', { name: 'ana' })).toHaveAttribute('href', '/admin/users/u1');
    expect(within(table).queryByRole('link', { name: 'bia' })).not.toBeInTheDocument();
    expect(within(table).getByText('bia')).toBeInTheDocument();
  });

  it('expanding shows the reason, the technical code, the target id and the request id', async () => {
    const u = userEvent.setup();
    open();
    await u.click((await screen.findAllByRole('button', { name: /detalhes de/ }))[0]!);
    expect(screen.getByText('spam em massa')).toBeInTheDocument();
    expect(screen.getByText('req-1')).toBeInTheDocument();
    expect(screen.getByText('user.suspend')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('known metadata becomes labelled rows; nested data stays behind "dados brutos", cut when huge', async () => {
    const u = userEvent.setup();
    mocked.fetchAudit.mockResolvedValue({ items: [auditRow({ action: 'group.assign_owner', detail: { newOwnerId: 'u9', previousOwnerIds: ['u1', 'u2'], extra: { deep: 'x'.repeat(3000) } } })], nextCursor: null });
    open();
    await u.click(await screen.findByRole('button', { name: /detalhes de/ }));
    expect(screen.getByText('Novo dono (ID)')).toBeInTheDocument();
    expect(screen.getByText('u9')).toBeInTheDocument();
    expect(screen.getByText('u1, u2')).toBeInTheDocument();
    expect(screen.getByText('Ver dados brutos')).toBeInTheDocument();
    expect(screen.getByText(/Mostrando os primeiros 2000 caracteres/)).toBeInTheDocument();
  });

  it('the action filter lists readable labels; choosing one sends the technical code', async () => {
    const u = userEvent.setup();
    open();
    await screen.findByRole('table');
    await u.selectOptions(screen.getByLabelText('Ação'), 'Conta suspensa');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'user.suspend' }), null));
  });

  it('an action code the labels do not know is kept from the URL, not reset', async () => {
    open('/admin/audit?action=custom.thing');
    await screen.findByRole('table');
    expect(screen.getByLabelText('Ação')).toHaveValue('custom.thing');
    expect(screen.getByRole('option', { name: 'custom.thing (código desconhecido)' })).toBeInTheDocument();
    expect(mocked.fetchAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'custom.thing' }), null);
  });

  it('administrator, target type and target id filters reach the server and show as active', async () => {
    const u = userEvent.setup();
    open();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Tipo de alvo'), 'group');
    await u.type(screen.getByLabelText('Administrador'), 'lune');
    await u.type(screen.getByLabelText('ID do alvo'), 'g1');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ targetType: 'group', actor: 'lune', targetId: 'g1' }), null));
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('the period end includes the whole last day, and the time zone used is shown', async () => {
    open('/admin/audit?from=2026-03-01&to=2026-03-31');
    await screen.findByText('Conta suspensa');
    expect(mocked.fetchAudit).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date(2026, 2, 1).toISOString(),
      to: new Date(2026, 3, 1).toISOString(),
    }), null);
    expect(screen.getByText(/Dias no fuso/)).toBeInTheDocument();
    expect(screen.getByLabelText('Até (inclusive)')).toHaveValue('2026-03-31');
  });

  it('compact: stacked records with the same details on demand, and no table', async () => {
    const u = userEvent.setup();
    vi.mocked(useAdminTableFits).mockReturnValue(false);
    open();
    expect(await screen.findByText('Conta suspensa')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await u.click(screen.getAllByRole('button', { name: /detalhes de/ })[0]!);
    expect(screen.getByText('req-1')).toBeInTheDocument();
  });

  it('failing to load the audit is not the same thing as an action that failed', async () => {
    mocked.fetchAudit.mockRejectedValue(new Error('offline'));
    open();
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(screen.queryByText('Falhou')).not.toBeInTheDocument();
  });

  it('is read-only: there is no edit or delete control', async () => {
    open();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /apagar|editar|excluir/i })).not.toBeInTheDocument();
  });
});
