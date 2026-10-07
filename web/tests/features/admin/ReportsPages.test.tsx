import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { ApiError } from '@/shared/api/api';
import { useAdminTableFits } from '@/features/admin/useAdminMode';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { ReportDetailPage } from '@/features/admin/ReportDetailPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/useAdminMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminMode')>()),
  useAdminTableFits: vi.fn(() => true),
}));
const mocked = vi.mocked(adminApi);

const row = (over: Partial<adminApi.AdminReportRow> = {}): adminApi.AdminReportRow => ({
  id: 'r1', targetType: 'message', targetId: '9', targetLabel: 'mensagem de bia', category: 'harassment', status: 'open', reporter: 'ana', assignee: null, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const detail = (over: Partial<adminApi.AdminReportDetail['report']> = {}): adminApi.AdminReportDetail => ({
  report: { ...row(), details: 'foi ofensivo', snapshot: { text: 'texto da mensagem', authorUsername: 'bia', conversationTitle: 'Squad', sentAt: '2026-01-01T00:00:00.000Z' }, resolution: '', resolutionNote: '', resolvedAt: null, ...over },
  history: [],
});
const openDetail = () => renderAdmin(<ReportDetailPage />, { path: '/admin/reports/r1', pattern: '/admin/reports/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminTableFits).mockReturnValue(true);
  mocked.fetchAdminReports.mockResolvedValue({ items: [row()], nextCursor: null });
  mocked.fetchAdminReport.mockResolvedValue(detail());
});

describe('ReportsPage', () => {
  it('lists the open queue as a table, the report opening its own page', async () => {
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    const link = await screen.findByRole('link', { name: /mensagem de bia/ });
    expect(link).toHaveAttribute('href', '/admin/reports/r1');
    expect(mocked.fetchAdminReports).toHaveBeenCalledWith({ status: 'open', targetType: undefined }, null);
    const table = screen.getByRole('table', { name: 'Denúncias' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Alvo', 'Categoria', 'Situação', 'Responsável', 'Recebida em']);
    expect(screen.getByText('1 denúncia carregada')).toBeInTheDocument();
  });

  it('the queue and the target type are filters, and both reach the server', async () => {
    const u = userEvent.setup();
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    await screen.findByRole('table');
    await u.selectOptions(screen.getByLabelText('Fila'), 'closed');
    await waitFor(() => expect(mocked.fetchAdminReports).toHaveBeenLastCalledWith({ status: 'closed', targetType: undefined }, null));
    await u.selectOptions(screen.getByLabelText('Tipo de alvo'), 'group');
    await waitFor(() => expect(mocked.fetchAdminReports).toHaveBeenLastCalledWith({ status: 'closed', targetType: 'group' }, null));
  });

  it('an assignee shows in the queue, a missing one as a dash', async () => {
    mocked.fetchAdminReports.mockResolvedValue({ items: [row({ assignee: 'lune', status: 'reviewing' }), row({ id: 'r2', assignee: null })], nextCursor: null });
    renderAdmin(<ReportsPage />, { path: '/admin/reports?status=reviewing', pattern: '/admin/reports' });
    expect(await screen.findByText('@lune')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('compact: stacked rows only', async () => {
    vi.mocked(useAdminTableFits).mockReturnValue(false);
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    expect(await screen.findByRole('link', { name: /mensagem de bia/ })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('opening the queue never fetches any evidence', async () => {
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    await screen.findByRole('table');
    expect(mocked.fetchAdminReport).not.toHaveBeenCalled();
  });
});

describe('ReportDetailPage', () => {
  it('reads as a sequence: identification, evidence, report, decision, history', async () => {
    openDetail();
    await screen.findByText('texto da mensagem');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Evidência', 'Denúncia', 'Decisão', 'Histórico']);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('mensagem de bia');
    expect(screen.getByText('r1')).toBeInTheDocument();
  });

  it('shows evidence and reporter (admin-only), and says when the stored text was truncated', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ snapshot: { text: 'texto da mensagem', authorId: 'u9', authorUsername: 'bia', conversationTitle: 'Squad', sentAt: '2026-01-01T00:00:00.000Z', truncated: true } }));
    openDetail();
    expect(await screen.findByText('texto da mensagem')).toBeInTheDocument();
    expect(screen.getByText('@ana')).toBeInTheDocument();
    expect(screen.getByText('foi ofensivo')).toBeInTheDocument();
    expect(screen.getByText(/foi truncado ao ser guardado/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@bia' })).toHaveAttribute('href', '/admin/users/u9');
  });

  it('the evidence is inert text: a URL inside it is not a link and nothing is fetched for it', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ snapshot: { text: 'veja https://evil.example/x <img src=x onerror=alert(1)>', authorId: null } }));
    const { container } = openDetail();
    expect(await screen.findByText(/veja https:\/\/evil.example\/x/)).toBeInTheDocument();
    expect(container.querySelector('a[href*="evil.example"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('a message by a deleted account has no link to the author; a deleted reporter says so', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ reporter: null, snapshot: { text: 'oi', authorId: null, authorUsername: null } }));
    openDetail();
    await screen.findByText('oi');
    expect(screen.getAllByText('conta apagada')).toHaveLength(2);
  });

  it('for a message report the outcomes are delete, suspend the author, no action, dismiss — never suspend the group', async () => {
    openDetail();
    await screen.findByText('texto da mensagem');
    const labels = screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent);
    expect(labels).toEqual([
      expect.stringContaining('Apagar a mensagem'), expect.stringContaining('Suspender a conta'),
      expect.stringContaining('Resolver sem ação'), expect.stringContaining('Dispensar'),
    ]);
    expect(screen.queryByRole('radio', { name: /Suspender o grupo/ })).not.toBeInTheDocument();
  });

  it('a group report only offers the group; a user report only the account', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ targetType: 'group', targetId: 'g1', targetLabel: 'Squad', snapshot: {} }));
    const { unmount } = openDetail();
    await screen.findByRole('radio', { name: /Suspender o grupo/ });
    expect(screen.queryByRole('radio', { name: /Apagar a mensagem/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Suspender a conta/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir no admin' })).toHaveAttribute('href', '/admin/groups/g1');
    unmount();

    mocked.fetchAdminReport.mockResolvedValue(detail({ targetType: 'user', targetId: 'u1', targetLabel: 'ana', snapshot: {} }));
    openDetail();
    await screen.findByRole('radio', { name: /Suspender a conta/ });
    expect(screen.queryByRole('radio', { name: /Suspender o grupo/ })).not.toBeInTheDocument();
  });

  it('nothing is decided before an outcome is chosen and confirmed with a reason', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockResolvedValue({ ok: true });
    openDetail();
    const go = await screen.findByRole('button', { name: 'Escolha um desfecho' });
    expect(go).toBeDisabled();
    await u.click(screen.getByRole('radio', { name: /Apagar a mensagem/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Apagar a mensagem' }));
    expect(mocked.resolveReport).not.toHaveBeenCalled();
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed offense');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenCalledWith('r1', { reason: 'confirmed offense', action: 'delete_message', dismiss: false }));
  });

  it('the dialog states the concrete effect on the concrete target: suspending the author is not suspending the group', async () => {
    const u = userEvent.setup();
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Suspender a conta/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Suspender a conta' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('A conta perde a sessão agora');
  });

  it('resolve without action and dismiss send their own payloads; claim has its own endpoint', async () => {
    const u = userEvent.setup();
    mocked.claimReport.mockResolvedValue({ ok: true });
    mocked.resolveReport.mockResolvedValue({ ok: true });
    openDetail();
    await u.click(await screen.findByRole('button', { name: 'Assumir análise' }));
    await u.type(screen.getByLabelText(/Motivo/), 'will review');
    await u.click(screen.getByRole('button', { name: 'Assumir' }));
    await waitFor(() => expect(mocked.claimReport).toHaveBeenCalledWith('r1', 'will review'));

    await u.click(await screen.findByRole('radio', { name: /Resolver sem ação/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Resolver sem ação' }));
    await u.type(screen.getByLabelText(/Motivo/), 'handled elsewhere');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenLastCalledWith('r1', { reason: 'handled elsewhere', action: null, dismiss: false }));

    await u.click(await screen.findByRole('radio', { name: /Dispensar/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Dispensar' }));
    await u.type(screen.getByLabelText(/Motivo/), 'no problem');
    await u.click(screen.getAllByRole('button', { name: 'Dispensar' }).at(-1)!);
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenLastCalledWith('r1', { reason: 'no problem', action: null, dismiss: true }));
  });

  it('a report already under analysis offers no claim', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'reviewing', assignee: 'lune' }));
    openDetail();
    await screen.findByText('texto da mensagem');
    expect(screen.queryByRole('button', { name: 'Assumir análise' })).not.toBeInTheDocument();
    expect(screen.getByText('@lune')).toBeInTheDocument();
  });

  it('a closed report shows result, reason and date, and no decision controls', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'resolved', resolution: 'message_deleted', resolutionNote: 'removed', resolvedAt: '2026-01-02T00:00:00.000Z' }));
    openDetail();
    expect(await screen.findByText('Mensagem apagada')).toBeInTheDocument();
    expect(screen.getByText('“removed”')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Decisão' })).not.toBeInTheDocument();
  });

  it('a dismissed report reads "Dispensada"', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'dismissed', resolution: 'no_action', resolutionNote: 'nothing', resolvedAt: '2026-01-02T00:00:00.000Z' }));
    openDetail();
    const outcome = (await screen.findByRole('heading', { name: 'Desfecho' })).closest('section')!;
    expect(outcome).toHaveTextContent('Dispensada');
  });

  it('a report somebody else closed meanwhile: explains it, re-reads, and does not claim success', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockRejectedValue(new ApiError(409, 'already_closed', 'x'));
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Dispensar/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Dispensar' }));
    await u.type(screen.getByLabelText(/Motivo/), 'no problem');
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'dismissed', resolution: 'no_action', resolutionNote: 'by other', resolvedAt: '2026-01-02T00:00:00.000Z' }));
    await u.click(screen.getAllByRole('button', { name: 'Dispensar' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('já foi encerrada por outra pessoa');
    await waitFor(() => expect(mocked.fetchAdminReport).toHaveBeenCalledTimes(2));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    const outcome = (await screen.findByRole('heading', { name: 'Desfecho' })).closest('section')!;
    expect(outcome).toHaveTextContent('Dispensada');
  });

  it('a failed action keeps the report open and says so', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockRejectedValue(new ApiError(409, 'action_failed', 'x'));
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Apagar a mensagem/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Apagar a mensagem' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed offense');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a denúncia continua aberta');
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('radio', { name: /Apagar a mensagem/ })).toBeChecked();
  });

  it('another decision in progress on the same report: told to refresh, not a generic failure', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockRejectedValue(new ApiError(409, 'conflict', 'Outra decisão sobre esta denúncia está em andamento. Atualize e confira o resultado.'));
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Resolver sem ação/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Resolver sem ação' }));
    await u.type(screen.getByLabelText(/Motivo/), 'handled elsewhere');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Outra decisão sobre esta denúncia está em andamento');
  });
});
