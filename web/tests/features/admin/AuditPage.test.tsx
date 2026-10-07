import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin, auditRow } from './adminFixture';
import { AuditPage } from '@/features/admin/AuditPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAudit.mockResolvedValue({ items: [auditRow(), auditRow({ id: 'a2', action: 'user.delete', result: 'failed' })], nextCursor: null });
});

describe('AuditPage', () => {
  it('lists records with readable labels and flags failures', async () => {
    renderAdmin(<AuditPage />, { path: '/admin/audit', pattern: '/admin/audit' });
    expect(await screen.findByText('Conta suspensa')).toBeInTheDocument();
    expect(screen.getByText('Conta excluída')).toBeInTheDocument();
    expect(screen.getByText('falhou')).toBeInTheDocument();
  });

  it('expanding shows the reason, target id and request id', async () => {
    const u = userEvent.setup();
    renderAdmin(<AuditPage />, { path: '/admin/audit', pattern: '/admin/audit' });
    await u.click((await screen.findAllByRole('button', { expanded: false }))[0]);
    expect(screen.getByText('spam em massa')).toBeInTheDocument();
    expect(screen.getByText('req-1')).toBeInTheDocument();
  });

  it('action and actor filters reach the server', async () => {
    const u = userEvent.setup();
    renderAdmin(<AuditPage />, { path: '/admin/audit', pattern: '/admin/audit' });
    await screen.findByText('Conta suspensa');
    await u.type(screen.getByLabelText('Ação'), 'user.suspend');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'user.suspend' }), null));
  });

  it('the period end includes the whole last day: the server gets the start of the next one', async () => {
    renderAdmin(<AuditPage />, { path: '/admin/audit?from=2026-03-01&to=2026-03-31', pattern: '/admin/audit' });
    await screen.findByText('Conta suspensa');
    expect(mocked.fetchAudit).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date(2026, 2, 1).toISOString(),
      to: new Date(2026, 3, 1).toISOString(),
    }), null);
  });

  it('is read-only: there is no edit or delete control', async () => {
    renderAdmin(<AuditPage />, { path: '/admin/audit', pattern: '/admin/audit' });
    await screen.findByText('Conta suspensa');
    expect(screen.queryByRole('button', { name: /apagar|editar|excluir/i })).not.toBeInTheDocument();
  });
});
