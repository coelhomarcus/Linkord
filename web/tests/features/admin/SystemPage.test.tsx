import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
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
  orphanSweep: { dryRunByDefault: true, last: null }, discord: { announcing: false }, ...over,
});
const open = () => renderAdmin(<SystemPage />, { path: '/admin/system', pattern: '/admin/system' });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchSystem.mockResolvedValue(info());
});

describe('SystemPage', () => {
  it('mostra a cota da instancia, conexoes, cadastros e servicos', async () => {
    open();
    expect(await screen.findByText(/10.0 MB de 100.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/4 de 50 \(até 5 por conta\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 de 30/)).toBeInTheDocument();
    expect(screen.getByText('configurado')).toBeInTheDocument();
    expect(screen.getByText('desligado')).toBeInTheDocument();
  });

  it('avisa quando o cadastro esta pausado e quando o outbox tem falhas', async () => {
    mocked.fetchSystem.mockResolvedValue(info({ accounts: { total: 20, newLastHour: 30, newPerHourCap: 30, activeAdmins: 2, suspended: 0 }, outbox: { pending: 1, failed: 2 } }));
    open();
    expect(await screen.findByText(/Cadastros pausados/)).toBeInTheDocument();
    expect(screen.getByText(/esgotaram as tentativas/)).toBeInTheDocument();
  });

  it('apagar orfaos exige a previa primeiro e depois motivo', async () => {
    const u = userEvent.setup();
    mocked.sweepOrphans.mockResolvedValueOnce({ result: sweep() }).mockResolvedValueOnce({ result: sweep({ dryRun: false, deleted: 3 }) });
    open();
    const apagar = await screen.findByRole('button', { name: 'Apagar órfãos' });
    expect(apagar).toBeDisabled();

    await u.click(screen.getByRole('button', { name: 'Ver órfãos (prévia)' }));
    expect(mocked.sweepOrphans).toHaveBeenCalledWith({ dryRun: true });
    expect(await screen.findByText(/3 arquivo\(s\) órfão\(s\)/)).toBeInTheDocument();
    expect(apagar).toBeEnabled();

    await u.click(apagar);
    await u.type(screen.getByLabelText(/Motivo/), 'limpeza mensal');
    await u.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(mocked.sweepOrphans).toHaveBeenLastCalledWith({ dryRun: false, reason: 'limpeza mensal' }));
    expect(await screen.findByText(/3 apagado\(s\), 0 falha\(s\)/)).toBeInTheDocument();
  });

  it('sem orfaos na previa, nao oferece apagar', async () => {
    const u = userEvent.setup();
    mocked.sweepOrphans.mockResolvedValue({ result: sweep({ orphanCount: 0, orphanBytes: 0 }) });
    open();
    await u.click(await screen.findByRole('button', { name: 'Ver órfãos (prévia)' }));
    await screen.findByText(/0 arquivo\(s\) órfão\(s\)/);
    expect(screen.getByRole('button', { name: 'Apagar órfãos' })).toBeDisabled();
  });

  it('erro de carga oferece nova tentativa', async () => {
    const u = userEvent.setup();
    mocked.fetchSystem.mockRejectedValueOnce(new Error('x'));
    open();
    await u.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/10.0 MB de 100.0 MB/)).toBeInTheDocument();
  });
});
