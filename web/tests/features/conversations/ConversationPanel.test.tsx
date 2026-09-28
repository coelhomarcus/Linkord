import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import type { RoomContextValue } from '@/state/RoomContext';
import { ConversationPanel } from '@/features/conversations/ConversationPanel';
import type { Conversation } from '@/shared/types/protocol';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { renderSocial } from '@tests/fixtures/socialFixture';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(),
}));
const mockedApi = vi.mocked(api);

// the direct-conversation gate needs the friends provider — covered by its
// own tests (tests/features/friends/DirectComposerGate.test.tsx)
vi.mock('@/features/friends/DirectComposerGate', () => ({ DirectComposerGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const joinedState = { ...initialRoomState, joined: true };

describe('ConversationPanel — botao de chamada', () => {
  const direct: Conversation = {
    id: 'c1', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
  };
  const me = { ...joinedState, me: { ...initialRoomState.me, userId: 'me' } };

  function renderPanel(room: Partial<RoomContextValue>) {
    const onOpenCall = vi.fn();
    renderSocial(
      <AnimatedSidebarProvider>
        <ConversationPanel onOpenProfile={() => {}} onOpenCall={onOpenCall} onOpenSearch={() => {}} onOpenDetails={() => {}} onOpenMedia={() => {}} />
      </AnimatedSidebarProvider>,
      { room: { state: me, conversations: [direct], activeConversationId: 'c1', ...room } },
    );
    return { onOpenCall };
  }

  afterEach(() => { vi.clearAllMocks(); });

  it('amigos: o botao liga normalmente', async () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    const { onOpenCall } = renderPanel({});
    await vi.waitFor(() => expect(mockedApi.fetchRelationship).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Entrar na chamada'));
    expect(onOpenCall).toHaveBeenCalledWith('c1');
  });

  it('quem nao e amigo: o botao fica desabilitado', async () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'none', retryAfter: null });
    const { onOpenCall } = renderPanel({});
    await vi.waitFor(() => expect(screen.getByLabelText('Entrar na chamada')).toBeDisabled());
    fireEvent.click(screen.getByLabelText('Entrar na chamada'));
    expect(onOpenCall).not.toHaveBeenCalled();
  });

  it('mostra o erro de uma chamada que nao conseguiu comecar, so na conversa dela', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    const dispatch = vi.fn();
    renderPanel({ dispatch, state: { ...me, callJoinError: { conversationId: 'c1', message: 'Vídeo/voz indisponível no momento.' } } });
    expect(screen.getByRole('alert')).toHaveTextContent('Vídeo/voz indisponível no momento.');
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: null });
  });

  it('erro de chamada de outra conversa nao aparece aqui', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    renderPanel({ state: { ...me, callJoinError: { conversationId: 'outra', message: 'falhou' } } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
