import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { ApiError } from '@/shared/api/api';
import { SystemPage } from '@/features/admin/SystemPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const sweep = (over: Partial<adminApi.SweepResult> = {}): adminApi.SweepResult => ({
  at: '2026-01-01T00:00:00.000Z', dryRun: true, scanned: 40, orphanCount: 3, orphanBytes: 3072, deleted: 0, failed: 0, recent: 1, missingFiles: 0, ...over,
});
const info = (over: Partial<adminApi.SystemInfo> = {}): adminApi.SystemInfo => ({
  storage: { usedBytes: 10 * 1024 * 1024, files: 12, maxBytes: 100 * 1024 * 1024 },
  connections: { live: 4, onlineAccounts: 3, max: 50, perAccountMax: 5 },
  accounts: { total: 20, newLastHour: 2, newPerHourCap: 30, activeAdmins: 2, suspended: 1 },
  livekit: { configured: true }, outbox: { pending: 0, failed: 0 }, notifications: { unread: 7 },
  orphanSweep: { dryRunByDefault: true, graceMs: 24 * 3600_000, last: null }, ...over,
});
const open = () => renderAdmin(<SystemPage />, { path: '/admin/system', pattern: '/admin/system' });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchSystem.mockResolvedValue(info());
});

describe('SystemPage', () => {
  it('shows instance quota, connections, signups and services, in vertical sections', async () => {
    open();
    expect(await screen.findByText(/10.0 MB de 100.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/4 de 50 \(até 5 por conta\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 de 30/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Estado da instância', 'Armazenamento', 'Contas e capacidade', 'Serviços', 'Manutenção de arquivos',
    ]);
    expect(document.getElementById('maintenance')).not.toBeNull();
  });

  it('says what a live connection is and what an online account is — different numbers', async () => {
    open();
    expect(await screen.findByText(/pessoas, não conexões/)).toBeInTheDocument();
  });

  it('LiveKit "configured" is configuration, not a health check', async () => {
    open();
    expect(await screen.findByText(/não testa a conexão/)).toBeInTheDocument();
  });

  it('warns when signups are paused, with the real condition, and when the outbox has failures', async () => {
    mocked.fetchSystem.mockResolvedValue(info({ accounts: { total: 20, newLastHour: 30, newPerHourCap: 30, activeAdmins: 2, suspended: 0 }, outbox: { pending: 1, failed: 2 } }));
    open();
    expect(await screen.findByText(/Cadastros pausados: as 30 novas contas/)).toBeInTheDocument();
    expect(screen.getByText(/esgotaram as tentativas/)).toBeInTheDocument();
  });

  it('a missing or zero storage limit shows no meter and no division — and does not pretend to be unlimited', async () => {
    mocked.fetchSystem.mockResolvedValue(info({ storage: { usedBytes: 5 * 1024 * 1024, files: 3, maxBytes: 0 } }));
    open();
    expect(await screen.findByText(/limite de armazenamento não foi informado/)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it('the storage meter reads out its percentage', async () => {
    open();
    const meter = await screen.findByRole('meter', { name: 'Armazenamento da instância' });
    expect(meter).toHaveAttribute('aria-valuetext', '10% do limite em uso');
  });

  it('shows when the numbers were read and re-reads only on request', async () => {
    const u = userEvent.setup();
    open();
    expect(await screen.findByText(/Última leitura às \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    expect(mocked.fetchSystem).toHaveBeenCalledTimes(1);
    await u.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(mocked.fetchSystem).toHaveBeenCalledTimes(2));
  });

  it('a failed refresh keeps the numbers and says they are from the earlier read', async () => {
    const u = userEvent.setup();
    open();
    await screen.findByText(/10.0 MB de 100.0 MB/);
    mocked.fetchSystem.mockRejectedValueOnce(new Error('offline'));
    await u.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível atualizar/);
    expect(screen.getByText(/10.0 MB de 100.0 MB/)).toBeInTheDocument();
  });

  it('the grace period comes from the server configuration, not from a hardcoded 24 h', async () => {
    mocked.fetchSystem.mockResolvedValue(info({ orphanSweep: { dryRunByDefault: true, graceMs: 6 * 3600_000, last: null } }));
    open();
    expect(await screen.findByText(/mais de 6 horas/)).toBeInTheDocument();
    expect(screen.queryByText(/24/)).not.toBeInTheDocument();
  });

  it('a server that does not report the grace period gets a generic, still correct, text', async () => {
    mocked.fetchSystem.mockResolvedValue(info({ orphanSweep: { dryRunByDefault: true, last: null } }));
    open();
    expect(await screen.findByText(/só arquivos antigos o bastante são considerados/)).toBeInTheDocument();
  });

  describe('orphan maintenance', () => {
    it('verify → review → confirm with a reason → the real result, with preview and execution labelled apart', async () => {
      const u = userEvent.setup();
      mocked.sweepOrphans.mockResolvedValueOnce({ result: sweep() }).mockResolvedValueOnce({ result: sweep({ dryRun: false, deleted: 2, orphanCount: 2, at: '2026-01-01T00:05:00.000Z' }) });
      open();
      const apagar = await screen.findByRole('button', { name: 'Apagar órfãos' });
      expect(apagar).toBeDisabled();

      await u.click(screen.getByRole('button', { name: 'Verificar órfãos' }));
      expect(mocked.sweepOrphans).toHaveBeenCalledWith({ dryRun: true });
      expect(await screen.findByText('Prévia — nada foi apagado')).toBeInTheDocument();
      expect(screen.getByText(/3 arquivo\(s\) órfão\(s\)/)).toBeInTheDocument();
      expect(apagar).toBeEnabled();

      await u.click(apagar);
      expect(await screen.findByRole('dialog')).toHaveTextContent('faz uma nova varredura');
      await u.type(screen.getByLabelText(/Motivo/), 'monthly cleanup');
      await u.click(screen.getByRole('button', { name: 'Apagar' }));
      await waitFor(() => expect(mocked.sweepOrphans).toHaveBeenLastCalledWith({ dryRun: false, reason: 'monthly cleanup' }));
      expect(await screen.findByText('Coleta executada')).toBeInTheDocument();
      expect(screen.getByText(/2 apagado\(s\), 0 falha\(s\)/)).toBeInTheDocument();
      // the preview described a disk that changed: gone, and delete is locked again until a new check
      expect(screen.queryByText('Prévia — nada foi apagado')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Apagar órfãos' })).toBeDisabled();
    });

    it('a partial failure stays visible, with the way to the audit trail, even after the summary refreshes', async () => {
      const u = userEvent.setup();
      mocked.sweepOrphans.mockResolvedValueOnce({ result: sweep() }).mockResolvedValueOnce({ result: sweep({ dryRun: false, deleted: 2, failed: 1 }) });
      open();
      await u.click(await screen.findByRole('button', { name: 'Verificar órfãos' }));
      await u.click(await screen.findByRole('button', { name: 'Apagar órfãos' }));
      await u.type(screen.getByLabelText(/Motivo/), 'cleanup');
      await u.click(screen.getByRole('button', { name: 'Apagar' }));
      expect(await screen.findByText(/2 apagado\(s\), 1 falha\(s\)/)).toBeInTheDocument();
      await waitFor(() => expect(mocked.fetchSystem).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('link', { name: 'Ver as falhas na auditoria' })).toHaveAttribute('href', '/admin/audit?action=storage.orphan_delete');
      expect(screen.getByText(/2 apagado\(s\), 1 falha\(s\)/)).toBeInTheDocument();
    });

    it('with no orphans in the preview, does not offer delete', async () => {
      const u = userEvent.setup();
      mocked.sweepOrphans.mockResolvedValue({ result: sweep({ orphanCount: 0, orphanBytes: 0 }) });
      open();
      await u.click(await screen.findByRole('button', { name: 'Verificar órfãos' }));
      await screen.findByText(/0 arquivo\(s\) órfão\(s\)/);
      expect(screen.getByRole('button', { name: 'Apagar órfãos' })).toBeDisabled();
    });

    it('while checking, neither action can be started a second time', async () => {
      const u = userEvent.setup();
      mocked.sweepOrphans.mockImplementation(() => new Promise(() => {}));
      open();
      await u.click(await screen.findByRole('button', { name: 'Verificar órfãos' }));
      expect(screen.getByRole('button', { name: 'Verificando…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apagar órfãos' })).toBeDisabled();
    });

    it('another sweep already running (409) is explained', async () => {
      const u = userEvent.setup();
      mocked.sweepOrphans.mockRejectedValue(new ApiError(409, 'conflict', 'Já existe uma varredura de arquivos em andamento.'));
      open();
      await u.click(await screen.findByRole('button', { name: 'Verificar órfãos' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma varredura de arquivos em andamento.');
    });

    it('shows the last scheduled sweep until the admin runs one of their own', async () => {
      mocked.fetchSystem.mockResolvedValue(info({ orphanSweep: { dryRunByDefault: true, graceMs: 24 * 3600_000, last: sweep() } }));
      open();
      expect(await screen.findByText('Última varredura (só relato)')).toBeInTheDocument();
    });
  });

  it('load error offers a retry', async () => {
    const u = userEvent.setup();
    mocked.fetchSystem.mockRejectedValueOnce(new Error('x'));
    open();
    await u.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/10.0 MB de 100.0 MB/)).toBeInTheDocument();
  });
});
