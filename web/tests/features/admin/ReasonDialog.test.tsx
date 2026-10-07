import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasonDialog } from '@/features/admin/ReasonDialog';
import { ApiError } from '@/shared/api/api';

const setup = (over: Partial<React.ComponentProps<typeof ReasonDialog>> = {}) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(<ReasonDialog open onOpenChange={onOpenChange} title="Suspender" description="desc" confirmLabel="Suspender" onSubmit={onSubmit} {...over} />);
  return { onSubmit, onOpenChange };
};

describe('ReasonDialog', () => {
  it('does not confirm without a reason of at least 3 characters', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const confirm = screen.getByRole('button', { name: 'Suspender' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Motivo/), 'ab');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Motivo/), 'c');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith('abc', '');
  });

  it('requires typing the confirmation when asked for (case-insensitive)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ confirmText: 'Ana', confirmLabel: 'Excluir' });
    await user.type(screen.getByLabelText(/Motivo/), 'abuse');
    const confirm = screen.getByRole('button', { name: 'Excluir' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Para confirmar/), 'ANA');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith('abuse', 'ANA');
  });

  it('only closes after the server responds; error stays visible and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = setup();
    onSubmit.mockRejectedValueOnce(new ApiError(409, 'last_admin', 'x'));
    await user.type(screen.getByLabelText(/Motivo/), 'valid reason');
    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('último administrador ativo');
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('validates and sends the reason the way the server normalizes it', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(screen.getByLabelText(/Motivo/), '   a    ');
    expect(screen.getByRole('button', { name: 'Suspender' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Motivo/), '\n\nb');
    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    expect(onSubmit).toHaveBeenCalledWith('a b', '');
  });

  describe('while the request is pending', () => {
    const pending = () => {
      let release!: () => void;
      const onSubmit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
      return { onSubmit, release: () => release() };
    };

    it('cannot be dismissed by Cancel, Escape or the close button, and keeps the typed reason', async () => {
      const user = userEvent.setup();
      const { onSubmit, release } = pending();
      const { onOpenChange } = setup({ onSubmit });
      await user.type(screen.getByLabelText(/Motivo/), 'valid reason');
      await user.click(screen.getByRole('button', { name: 'Suspender' }));

      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/Motivo/)).toHaveValue('valid reason');

      release();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it('a second click does not send the action twice', async () => {
      const user = userEvent.setup();
      const { onSubmit } = pending();
      setup({ onSubmit });
      await user.type(screen.getByLabelText(/Motivo/), 'valid reason');
      await user.click(screen.getByRole('button', { name: 'Suspender' }));
      await user.click(screen.getByRole('button', { name: 'Aguarde…' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
