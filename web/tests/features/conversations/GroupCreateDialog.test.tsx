import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ana, bea } from '@tests/fixtures/socialFixture';
import { GroupCreateDialog } from '@/features/conversations/GroupCreateDialog';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriends: vi.fn(), createGroup: vi.fn(),
}));
const mocked = vi.mocked(api);
const friends = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchFriends.mockResolvedValue(friends(ana, bea));
});

function setup() {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  renderWithRoom(<GroupCreateDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { onOpenChange, onCreated };
}

describe('GroupCreateDialog', () => {
  it('convida so amigos e avisa que a entrada depende do aceite', async () => {
    setup();
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/só entram no grupo ao aceitar/)).toBeInTheDocument();
  });

  it('cria com os amigos selecionados via API e so fecha depois do resultado', async () => {
    const user = userEvent.setup();
    let resolve!: (v: Awaited<ReturnType<typeof api.createGroup>>) => void;
    mocked.createGroup.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onOpenChange, onCreated } = setup();

    await user.type(screen.getByLabelText('Nome'), 'Squad');
    await user.click(await screen.findByRole('button', { name: /Ana/ }));
    await user.click(screen.getByRole('button', { name: 'Criar e convidar (1)' }));
    expect(mocked.createGroup).toHaveBeenCalledWith('Squad', ['u-ana']);
    expect(onOpenChange).not.toHaveBeenCalled();

    resolve({ conversationId: 'g', results: [{ userId: 'u-ana', outcome: 'sent', invitationId: 'i' }] });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalled();
  });

  it('permite criar sem convidados', async () => {
    const user = userEvent.setup();
    mocked.createGroup.mockResolvedValue({ conversationId: 'g', results: [] });
    setup();
    await user.type(screen.getByLabelText('Nome'), 'Sozinho');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(mocked.createGroup).toHaveBeenCalledWith('Sozinho', []);
  });

  it('a selecao sobrevive a uma nova busca', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockImplementation(async (_cursor, q) => (q ? friends(bea) : friends(ana, bea)));
    setup();
    await user.click(await screen.findByRole('button', { name: /Ana/ }));
    await user.type(screen.getByPlaceholderText('Buscar amigos'), 'be');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Ana/ })).not.toBeInTheDocument());
    await user.type(screen.getByLabelText('Nome'), 'G');
    expect(screen.getByRole('button', { name: 'Criar e convidar (1)' })).toBeInTheDocument();
  });

  it('convites que falharam ficam visiveis e o dialogo continua aberto', async () => {
    const user = userEvent.setup();
    mocked.createGroup.mockResolvedValue({ conversationId: 'g', results: [{ userId: 'u-ana', outcome: 'not_friends' }] });
    const { onOpenChange } = setup();
    await user.type(screen.getByLabelText('Nome'), 'Squad');
    await user.click(await screen.findByRole('button', { name: /Ana/ }));
    await user.click(screen.getByRole('button', { name: 'Criar e convidar (1)' }));

    expect(await screen.findByText(/não é mais seu amigo/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('erro de rede mantem o formulario preenchido', async () => {
    const user = userEvent.setup();
    mocked.createGroup.mockRejectedValue(new Error('x'));
    setup();
    await user.type(screen.getByLabelText('Nome'), 'Squad');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível criar/);
    expect(screen.getByLabelText('Nome')).toHaveValue('Squad');
  });
});
