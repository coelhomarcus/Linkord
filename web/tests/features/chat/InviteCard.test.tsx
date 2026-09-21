import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { InviteCard } from '@/features/chat/InviteCard';
import * as api from '@/shared/api/api';
import type { Conversation, InvitationCard } from '@/shared/types/protocol';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  acceptInvitation: vi.fn(), declineInvitation: vi.fn(), revokeInvitation: vi.fn(),
}));
const mocked = vi.mocked(api);

const card = (over: Partial<InvitationCard> = {}): InvitationCard => ({
  id: 'inv-1', status: 'pending', groupId: 'g1', groupTitle: 'Squad', groupAvatar: '', memberCount: 3,
  inviterId: 'owner', inviteeId: 'me', version: 1, ...over,
});
const group = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'g1', type: 'group', title: 'Squad', avatar: '', createdBy: 'owner', memberIds: ['owner'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0, ...over,
});
const asUser = (userId: string, conversations: Conversation[] = [], openConversation = vi.fn()) => renderWithRoom(<Slot />, {
  state: { ...initialRoomState, me: { ...initialRoomState.me, userId } }, conversations, openConversation,
});
let current: InvitationCard | null | undefined;
function Slot() { return <InviteCard invitation={current} />; }
const render = (invitation: InvitationCard | null, userId = 'me', conversations: Conversation[] = [], open = vi.fn()) => {
  current = invitation;
  return asUser(userId, conversations, open);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('InviteCard', () => {
  it('destinatario ve Entrar/Recusar num convite pendente', async () => {
    const user = userEvent.setup();
    mocked.acceptInvitation.mockResolvedValue({ invitation: card({ status: 'accepted' }) });
    render(card());
    expect(screen.getByText('Squad')).toBeInTheDocument();
    expect(screen.getByText(/verá o histórico/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar no grupo' }));
    expect(mocked.acceptInvitation).toHaveBeenCalledWith('inv-1');
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeInTheDocument();
  });

  it('recusar chama o endpoint de recusa', async () => {
    const user = userEvent.setup();
    mocked.declineInvitation.mockResolvedValue({ invitation: card({ status: 'declined' }) });
    render(card());
    await user.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(mocked.declineInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('erro group_full mostra "Limite atingido" sem oferecer Entrar', async () => {
    const user = userEvent.setup();
    mocked.acceptInvitation.mockRejectedValue(new api.ApiError(409, 'group_full', 'cheio'));
    render(card());
    await user.click(screen.getByRole('button', { name: 'Entrar no grupo' }));
    expect(await screen.findByText(/Limite atingido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar no grupo' })).not.toBeInTheDocument();
  });

  it('convidador ve "Aguardando" e so revoga se ainda for dono', async () => {
    const user = userEvent.setup();
    mocked.revokeInvitation.mockResolvedValue({ invitation: card({ status: 'revoked' }) });
    const { unmount } = render(card(), 'owner', [group({ myRole: 'owner' })]);
    expect(screen.getByText(/Aguardando resposta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(mocked.revokeInvitation).toHaveBeenCalledWith('inv-1');
    unmount();

    render(card(), 'owner', [group({ myRole: 'member' })]);
    expect(screen.queryByRole('button', { name: 'Revogar' })).not.toBeInTheDocument();
  });

  it('aceito: "Abrir grupo" so aparece enquanto ainda for membro', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const { unmount } = render(card({ status: 'accepted' }), 'me', [group()], open);
    await user.click(screen.getByRole('button', { name: 'Abrir grupo' }));
    expect(open).toHaveBeenCalledWith('g1');
    unmount();

    render(card({ status: 'accepted' }), 'me', []);
    expect(screen.queryByRole('button', { name: 'Abrir grupo' })).not.toBeInTheDocument();
    expect(screen.getByText('Aceito')).toBeInTheDocument();
  });

  it.each([['declined', 'Recusado'], ['revoked', 'Cancelado'], ['expired', 'Expirado']] as const)('estado terminal %s', (status, label) => {
    render(card({ status }));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar no grupo' })).not.toBeInTheDocument();
  });

  it('pendente mas ja membro: "Você já participa"', () => {
    render(card(), 'me', [group()]);
    expect(screen.getByText(/já participa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar no grupo' })).not.toBeInTheDocument();
  });

  it('pendente nao mostra prazo: convite nominal nao expira', () => {
    render(card());
    expect(screen.getByText('Entrar no grupo')).toBeInTheDocument();
    expect(screen.queryByText(/vence/)).not.toBeInTheDocument();
  });

  it('tombstone quando o grupo foi apagado', () => {
    render(null);
    expect(screen.getByText(/Convite indisponível/)).toBeInTheDocument();
  });

  it('erro genérico mostra alerta e mantém os botões', async () => {
    const user = userEvent.setup();
    mocked.acceptInvitation.mockRejectedValue(new Error('boom'));
    render(card());
    await user.click(screen.getByRole('button', { name: 'Entrar no grupo' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Entrar no grupo' })).toBeEnabled();
  });
});
