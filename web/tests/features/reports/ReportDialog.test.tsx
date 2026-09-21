import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ReportDialog } from '@/features/reports/ReportDialog';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  submitReport: vi.fn(),
}));
const mocked = vi.mocked(api);
const target = { type: 'message' as const, id: '42', label: 'mensagem de Ana' };

beforeEach(() => vi.clearAllMocks());

describe('ReportDialog', () => {
  it('so envia depois de escolher um motivo', async () => {
    const user = userEvent.setup();
    mocked.submitReport.mockResolvedValue({ ok: true });
    renderWithRoom(<ReportDialog target={target} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Enviar denúncia' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Spam ou propaganda' }));
    await user.type(screen.getByLabelText('Detalhes'), '  muito spam ');
    await user.click(screen.getByRole('button', { name: 'Enviar denúncia' }));

    expect(mocked.submitReport).toHaveBeenCalledWith({ targetType: 'message', targetId: '42', category: 'spam', details: 'muito spam' });
    expect(await screen.findByText('Denúncia enviada.')).toBeInTheDocument();
  });

  it('a confirmacao e neutra e o dialogo fecha limpo', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    mocked.submitReport.mockResolvedValue({ ok: true });
    renderWithRoom(<ReportDialog target={target} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('radio', { name: 'Outro motivo' }));
    await user.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    await screen.findByText('Denúncia enviada.');
    expect(screen.getByText(/sigilosa|A administração vai analisar/)).toBeInTheDocument();
    await user.click(screen.getByText('Fechar', { selector: 'button' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('erro mostra alerta e mantem o formulario para nova tentativa', async () => {
    const user = userEvent.setup();
    mocked.submitReport.mockRejectedValueOnce(new api.ApiError(429, 'rate_limited', 'x')).mockResolvedValueOnce({ ok: true });
    renderWithRoom(<ReportDialog target={target} open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Assédio ou ameaça' }));
    await user.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/muitas denúncias/);
    expect(screen.getByRole('radio', { name: 'Assédio ou ameaça' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    await waitFor(() => expect(screen.getByText('Denúncia enviada.')).toBeInTheDocument());
  });

  it('o titulo acompanha o tipo do alvo', () => {
    renderWithRoom(<ReportDialog target={{ type: 'group', id: 'g', label: 'Squad' }} open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Denunciar grupo')).toBeInTheDocument();
  });
});
