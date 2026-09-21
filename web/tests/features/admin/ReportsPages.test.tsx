import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { ReportDetailPage } from '@/features/admin/ReportDetailPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
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
  mocked.fetchAdminReports.mockResolvedValue({ items: [row()], nextCursor: null });
  mocked.fetchAdminReport.mockResolvedValue(detail());
});

describe('ReportsPage', () => {
  it('lista a fila aberta e troca de fila pelo filtro', async () => {
    const u = userEvent.setup();
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    expect(await screen.findByRole('link', { name: /Mensagem: mensagem de bia/ })).toHaveAttribute('href', '/admin/reports/r1');
    expect(mocked.fetchAdminReports).toHaveBeenCalledWith({ status: 'open' }, null);
    await u.click(screen.getByRole('button', { name: 'Encerradas' }));
    await waitFor(() => expect(mocked.fetchAdminReports).toHaveBeenLastCalledWith({ status: 'closed' }, null));
  });
});

describe('ReportDetailPage', () => {
  it('mostra evidencia e denunciante (so para a administracao)', async () => {
    openDetail();
    expect(await screen.findByText('texto da mensagem')).toBeInTheDocument();
    expect(screen.getByText('@ana')).toBeInTheDocument();
    expect(screen.getByText('foi ofensivo')).toBeInTheDocument();
  });

  it('em denuncia de mensagem, as acoes sao apagar ou suspender o autor — nunca suspender o grupo', async () => {
    openDetail();
    await screen.findByText('texto da mensagem');
    expect(screen.getByRole('button', { name: 'Apagar a mensagem' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspender a conta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspender o grupo' })).not.toBeInTheDocument();
  });

  it('resolver com acao exige motivo e manda acao + motivo', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockResolvedValue({ ok: true });
    openDetail();
    await u.click(await screen.findByRole('button', { name: 'Apagar a mensagem' }));
    await u.type(screen.getByLabelText(/Motivo/), 'ofensa confirmada');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenCalledWith('r1', { reason: 'ofensa confirmada', action: 'delete_message', dismiss: false }));
  });

  it('dispensar e assumir usam os endpoints proprios', async () => {
    const u = userEvent.setup();
    mocked.claimReport.mockResolvedValue({ ok: true });
    mocked.resolveReport.mockResolvedValue({ ok: true });
    openDetail();
    await u.click(await screen.findByRole('button', { name: 'Assumir análise' }));
    await u.type(screen.getByLabelText(/Motivo/), 'vou analisar');
    await u.click(screen.getByRole('button', { name: 'Assumir' }));
    await waitFor(() => expect(mocked.claimReport).toHaveBeenCalledWith('r1', 'vou analisar'));

    await u.click(await screen.findByRole('button', { name: 'Dispensar' }));
    await u.type(screen.getByLabelText(/Motivo/), 'sem problema');
    await u.click(screen.getAllByRole('button', { name: 'Dispensar' }).at(-1)!);
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenCalledWith('r1', { reason: 'sem problema', action: null, dismiss: true }));
  });

  it('denuncia encerrada nao oferece acoes e mostra o desfecho', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'resolved', resolution: 'message_deleted', resolutionNote: 'removida' }));
    openDetail();
    expect(await screen.findByText(/message_deleted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apagar a mensagem' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispensar' })).not.toBeInTheDocument();
  });
});
