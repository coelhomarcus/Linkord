import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { AccessNotice } from '@/app/layout/AccessNotice';

afterEach(() => vi.useRealTimers());

describe('AccessNotice', () => {
  it('nao renderiza nada sem aviso', () => {
    renderWithRoom(<AccessNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mostra o aviso e deixa dispensar', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    renderWithRoom(<AccessNotice />, { accessNotice: 'Você foi removido do grupo "Squad".', clearAccessNotice: clear });
    expect(screen.getByRole('status')).toHaveTextContent('Você foi removido do grupo "Squad".');
    await user.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(clear).toHaveBeenCalled();
  });

  it('some sozinho depois de um tempo', () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    renderWithRoom(<AccessNotice />, { accessNotice: 'aviso', clearAccessNotice: clear });
    act(() => { vi.advanceTimersByTime(10_500); });
    expect(clear).toHaveBeenCalled();
  });
});
