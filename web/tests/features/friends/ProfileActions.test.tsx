import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { ProfileActions } from '@/features/friends/ProfileActions';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(), sendFriendRequest: vi.fn(), acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(), cancelFriendRequest: vi.fn(), unblockUser: vi.fn(),
}));
const mocked = vi.mocked(api);

function renderActions(relation: api.Relation, retryAfter: string | null = null, onNavigate = vi.fn()) {
  mocked.fetchRelationship.mockResolvedValue({ relation, retryAfter });
  return renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" onNavigate={onNavigate} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0 });
});

describe('ProfileActions — o que aparece depende so da relacao', () => {
  it('sem relacao: Adicionar amigo envia a solicitacao pelo username', async () => {
    const user = userEvent.setup();
    mocked.sendFriendRequest.mockResolvedValue('created');
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(mocked.sendFriendRequest).toHaveBeenCalledWith('ana');
  });

  it('sem relacao mas em cooldown: nao oferece o botao, diz quando volta', async () => {
    renderActions('none', '2099-01-01T12:00:00.000Z');
    expect(await screen.findByText(/poderá enviar uma nova solicitação a partir de/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar amigo' })).not.toBeInTheDocument();
  });

  it('solicitacao enviada: mostra o estado e permite cancelar', async () => {
    const user = userEvent.setup();
    mocked.cancelFriendRequest.mockResolvedValue({});
    renderActions('outgoing');

    expect(await screen.findByText('Solicitação enviada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocked.cancelFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('solicitacao recebida: Aceitar e Recusar', async () => {
    const user = userEvent.setup();
    mocked.acceptFriendRequest.mockResolvedValue({});
    mocked.declineFriendRequest.mockResolvedValue({});
    renderActions('incoming');

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(mocked.acceptFriendRequest).toHaveBeenCalledWith('u-ana');
    await user.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(mocked.declineFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('amigos: Mensagem (fecha o modal) e menu com Remover/Bloquear', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderActions('friends', null, onNavigate);

    await user.click(await screen.findByRole('button', { name: 'Mensagem' }));
    expect(onNavigate).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(await screen.findByRole('menuitem', { name: 'Remover amizade' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Bloquear' })).toBeInTheDocument();
  });

  it('bloqueada por mim: so Desbloquear', async () => {
    const user = userEvent.setup();
    mocked.unblockUser.mockResolvedValue({});
    renderActions('blocked');

    expect(await screen.findByText('Você bloqueou essa pessoa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(mocked.unblockUser).toHaveBeenCalledWith('u-ana');
  });

  it('proprio perfil: Editar perfil, nenhuma acao social', async () => {
    renderActions('self');
    expect(await screen.findByRole('button', { name: 'Editar perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar amigo' })).not.toBeInTheDocument();
  });

  it('falha ao carregar a relacao: erro com tentar de novo, nunca fecha em silencio', async () => {
    const user = userEvent.setup();
    mocked.fetchRelationship.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ relation: 'none', retryAfter: null });
    renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" />);

    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument();
  });

  it('erro do envio usa a mensagem generica', async () => {
    const user = userEvent.setup();
    mocked.sendFriendRequest.mockRejectedValue(new api.ApiError(404, 'user_unavailable', 'x'));
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Confira o nome de usuário/);
  });
});
