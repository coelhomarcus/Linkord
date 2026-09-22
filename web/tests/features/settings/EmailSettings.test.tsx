import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailSettings } from '@/features/settings/EmailSettings';
import { ApiError } from '@/shared/api/api';

const requestEmailChange = vi.fn();
const confirmEmailChange = vi.fn();
const refresh = vi.fn();

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  requestEmailChange: (...args: unknown[]) => requestEmailChange(...args),
  confirmEmailChange: (...args: unknown[]) => confirmEmailChange(...args),
}));

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ refresh }),
}));

const codeLabel = 'Código de confirmação de e-mail';

beforeEach(() => {
  requestEmailChange.mockReset();
  confirmEmailChange.mockReset();
  refresh.mockReset();
});

async function requestCode(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.click(screen.getByRole('button', { name: 'Alterar e-mail' }));
  await user.clear(screen.getByLabelText('Novo e-mail'));
  await user.type(screen.getByLabelText('Novo e-mail'), email);
  await user.click(screen.getByRole('button', { name: 'Enviar código' }));
}

describe('EmailSettings', () => {
  it('comeca so mostrando o e-mail atual, sem formulario aberto', () => {
    render(<EmailSettings currentEmail="fulana@example.com" />);
    expect(screen.getByText('fulana@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Novo e-mail')).not.toBeInTheDocument();
  });

  it('alterar e-mail abre o formulario; cancelar fecha sem chamar a API', async () => {
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Alterar e-mail' }));
    expect(screen.getByLabelText('Novo e-mail')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Novo e-mail')).not.toBeInTheDocument();
    expect(requestEmailChange).not.toHaveBeenCalled();
  });

  it('valida vazio, invalido e igual ao atual antes de chamar a API', async () => {
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Alterar e-mail' }));

    // pre-filled with the current address for convenience — the "same as
    // current" case is covered separately, this one needs a blank field
    await user.clear(screen.getByLabelText('Novo e-mail'));
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um e-mail.');

    await user.type(screen.getByLabelText('Novo e-mail'), 'nao-e-email');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um e-mail válido.');

    await user.clear(screen.getByLabelText('Novo e-mail'));
    await user.type(screen.getByLabelText('Novo e-mail'), 'FULANA@example.com');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um e-mail diferente do atual.');

    expect(requestEmailChange).not.toHaveBeenCalled();
  });

  it('envia o codigo e mostra o campo de confirmacao para o endereco pedido', async () => {
    requestEmailChange.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);

    await requestCode(user, 'nova@example.com');

    expect(requestEmailChange).toHaveBeenCalledWith('nova@example.com');
    expect(screen.getByText(/nova@example\.com/)).toBeInTheDocument();
    expect(screen.getByLabelText(codeLabel)).toBeInTheDocument();
  });

  it('erro ao enviar o codigo mostra o motivo e mantem o formulario', async () => {
    requestEmailChange.mockRejectedValue(new ApiError(409, 'email_taken', 'Esse e-mail já está em uso.'));
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);

    await requestCode(user, 'nova@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('Esse e-mail já está em uso.');
    expect(screen.getByLabelText('Novo e-mail')).toBeInTheDocument();
  });

  it('confirma o codigo, mostra sucesso e so depois volta a mostrar o e-mail atualizado', async () => {
    requestEmailChange.mockResolvedValue({ ok: true });
    confirmEmailChange.mockResolvedValue({ user: { id: 'u1', email: 'nova@example.com' } });
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await requestCode(user, 'nova@example.com');

    await user.type(screen.getByLabelText(codeLabel), '123456');
    expect(await screen.findByText('E-mail alterado para nova@example.com.')).toBeInTheDocument();
    expect(confirmEmailChange).toHaveBeenCalledWith('nova@example.com', '123456');
    expect(refresh).toHaveBeenCalled();
    // still showing the success message, not already collapsed back to the
    // read-only view — refresh() resolving (and currentEmail changing on a
    // rerender) must not yank the confirmation off screen instantly.
    expect(screen.queryByLabelText('Novo e-mail')).not.toBeInTheDocument();
  });

  it('onComplete e um clique simultaneo no confirmar nao mandam dois pedidos', async () => {
    requestEmailChange.mockResolvedValue({ ok: true });
    let resolveConfirm: (v: { user: { id: string; email: string } }) => void = () => {};
    confirmEmailChange.mockImplementation(() => new Promise((resolve) => { resolveConfirm = resolve; }));
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await requestCode(user, 'nova@example.com');

    await user.type(screen.getByLabelText(codeLabel), '123456');
    // onComplete already fired from typing the 6th digit; the button click
    // right after must not fire a second confirm while the first is pending.
    await user.click(screen.getByRole('button', { name: /Confirmando|Confirmar e-mail/ }));
    expect(confirmEmailChange).toHaveBeenCalledTimes(1);

    resolveConfirm({ user: { id: 'u1', email: 'nova@example.com' } });
    await screen.findByText('E-mail alterado para nova@example.com.');
  });

  it('codigo invalido mostra o motivo e deixa tentar de novo', async () => {
    requestEmailChange.mockResolvedValue({ ok: true });
    confirmEmailChange.mockRejectedValue(new ApiError(400, 'invalid_code', 'Código inválido.'));
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await requestCode(user, 'nova@example.com');

    await user.type(screen.getByLabelText(codeLabel), '000000');
    expect(await screen.findByText('Código inválido.')).toBeInTheDocument();
    expect(screen.getByLabelText(codeLabel)).toBeInTheDocument();
  });

  it('reenviar codigo chama a API de novo para o mesmo endereco', async () => {
    requestEmailChange.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await requestCode(user, 'nova@example.com');

    await user.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(requestEmailChange).toHaveBeenCalledTimes(2);
    expect(requestEmailChange).toHaveBeenLastCalledWith('nova@example.com');
    expect(await screen.findByRole('button', { name: 'Código reenviado' })).toBeInTheDocument();
  });

  it('usar outro e-mail volta para o formulario de edicao', async () => {
    requestEmailChange.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EmailSettings currentEmail="fulana@example.com" />);
    await requestCode(user, 'nova@example.com');

    await user.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    expect(screen.getByLabelText('Novo e-mail')).toBeInTheDocument();
    expect(screen.queryByLabelText(codeLabel)).not.toBeInTheDocument();
  });
});
