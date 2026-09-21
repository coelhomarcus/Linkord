import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial, ana } from '@tests/fixtures/socialFixture';
import { PrivacyTab } from '@/features/settings/PrivacyTab';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchBlocks: vi.fn(), fetchRequestSummary: vi.fn(), unblockUser: vi.fn(),
}));
const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
});

describe('PrivacyTab', () => {
  it('lista os bloqueados e desbloqueia — deixando claro que a amizade nao volta', async () => {
    const user = userEvent.setup();
    mocked.fetchBlocks.mockResolvedValueOnce({ items: [{ user: ana, at: '2026-01-01T00:00:00.000Z' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    mocked.unblockUser.mockResolvedValue({});
    renderSocial(<PrivacyTab onOpenProfile={vi.fn()} />);

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/Desbloquear não devolve a amizade/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }));

    expect(mocked.unblockUser).toHaveBeenCalledWith('u-ana');
    await waitFor(() => expect(screen.getByText('Você não bloqueou ninguém.')).toBeInTheDocument());
  });

  it('nao mostra presenca dos bloqueados', async () => {
    mocked.fetchBlocks.mockResolvedValue({ items: [{ user: ana, at: '2026-01-01T00:00:00.000Z' }], nextCursor: null });
    renderSocial(<PrivacyTab onOpenProfile={vi.fn()} />);
    await screen.findByText('Ana');
    expect(screen.queryByText(/online|offline/i)).not.toBeInTheDocument();
  });
});
