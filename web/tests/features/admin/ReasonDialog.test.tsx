import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('nao confirma sem motivo com pelo menos 3 caracteres', async () => {
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

  it('exige digitar a confirmacao quando pedida (sem diferenciar maiusculas)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ confirmText: 'Ana', confirmLabel: 'Excluir' });
    await user.type(screen.getByLabelText(/Motivo/), 'abuso');
    const confirm = screen.getByRole('button', { name: 'Excluir' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Para confirmar/), 'ANA');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith('abuso', 'ANA');
  });

  it('so fecha depois do servidor responder; erro fica visivel e mantem o dialogo', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = setup();
    onSubmit.mockRejectedValueOnce(new ApiError(409, 'last_admin', 'x'));
    await user.type(screen.getByLabelText(/Motivo/), 'motivo');
    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('último administrador ativo');
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
