import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { DirectComposerGate } from '@/features/friends/DirectComposerGate';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(),
}));
const mocked = vi.mocked(api);

const peer: PublicUser = { id: 'peer', username: 'peer', displayName: 'Peer', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
const conversation = (over: Partial<Conversation>): Conversation => ({
  id: 'c1', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
  lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0, ...over,
});
const me = { ...initialRoomState, joined: true, me: { ...initialRoomState.me, userId: 'me' } };

function renderGate(conv: Conversation) {
  return renderSocial(
    <DirectComposerGate conversationId={conv.id}><p>compositor</p></DirectComposerGate>,
    { room: { state: me, conversations: [conv], allUsers: new Map([[peer.id, peer]]) } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
});

describe('DirectComposerGate', () => {
  it('amigos: o compositor fica', async () => {
    mocked.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    renderGate(conversation({}));
    expect(await screen.findByText('compositor')).toBeInTheDocument();
    expect(screen.queryByText(/precisam ser amigos/)).not.toBeInTheDocument();
  });

  it('nao amigos: aviso no lugar do compositor, com a acao que resolve', async () => {
    mocked.fetchRelationship.mockResolvedValue({ relation: 'none', retryAfter: null });
    renderGate(conversation({}));
    expect(await screen.findByText(/precisam ser amigos/)).toBeInTheDocument();
    expect(screen.queryByText('compositor')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument();
  });

  it('bloqueado por mim: pede para desbloquear', async () => {
    mocked.fetchRelationship.mockResolvedValue({ relation: 'blocked', retryAfter: null });
    renderGate(conversation({}));
    expect(await screen.findByText(/enquanto essa pessoa estiver bloqueada/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Desbloquear' })).toBeInTheDocument();
  });

  it('enquanto carrega ou se falhar, o compositor NAO some (o servidor e quem recusa a escrita)', async () => {
    mocked.fetchRelationship.mockReturnValue(new Promise(() => {}));
    const first = renderGate(conversation({}));
    expect(screen.getByText('compositor')).toBeInTheDocument();
    first.unmount();

    mocked.fetchRelationship.mockRejectedValue(new Error('x'));
    renderGate(conversation({}));
    expect(await screen.findByText('compositor')).toBeInTheDocument();
    expect(screen.queryByText(/precisam ser amigos/)).not.toBeInTheDocument();
  });

  it('grupo: nunca consulta a relacao nem mostra aviso', () => {
    renderGate(conversation({ type: 'group', memberIds: ['me', 'peer', 'other'] }));
    expect(screen.getByText('compositor')).toBeInTheDocument();
    expect(mocked.fetchRelationship).not.toHaveBeenCalled();
  });
});
