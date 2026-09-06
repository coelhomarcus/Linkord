import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreCallDialog } from './PreCallDialog';

describe('PreCallDialog', () => {
  it('entra mutado por padrao e envia a escolha sem ativar dispositivos antes', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onJoin, onOpenChange });

    expect(screen.getByRole('switch', { name: 'Entrar com microfone mutado' })).toBeChecked();
    expect(screen.getByText(/pode solicitar permissao/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entrar na chamada' }));

    expect(onJoin).toHaveBeenCalledWith({ muted: true, listenOnly: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('oferece somente ouvir sem pedir microfone', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    renderDialog({ onJoin });

    await user.click(screen.getByRole('switch', { name: 'Somente ouvir' }));

    // Base UI renders Switch as a span with aria-disabled instead of a
    // native disabled button/input.
    expect(screen.getByRole('switch', { name: 'Entrar com microfone mutado' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/nao solicitara permissao/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Entrar na chamada' }));
    expect(onJoin).toHaveBeenCalledWith({ muted: true, listenOnly: true });
  });
});

function renderDialog({
  onJoin = vi.fn(),
  onOpenChange = vi.fn(),
}: {
  onJoin?: (options: { muted?: boolean; listenOnly?: boolean }) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return render(
    <PreCallDialog
      open
      channelName="Geral"
      permissionNeeded
      onOpenChange={onOpenChange}
      onJoin={onJoin}
    />,
  );
}
