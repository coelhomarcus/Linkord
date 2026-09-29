import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';

const userState = {
  ...initialRoomState,
  me: { ...initialRoomState.me, userId: 'me', role: 'user' as const },
};

describe('GlobalContextMenu', () => {
  it('does not open an empty popup when the target has no actions', () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div data-testid="empty-area">no actions</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    expect(document.querySelector('[data-slot="context-menu-content"]')).not.toBeInTheDocument();
  });

  it('still opens when the target has visible actions', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <main data-stage data-testid="stage" />
      </GlobalContextMenu>,
      { state: userState, setHideAudioOnlyTiles: vi.fn() }
    );

    fireEvent.contextMenu(screen.getByTestId('stage'));

    expect(await screen.findByText('Ocultar sem vídeo')).toBeInTheDocument();
  });

  it('closes the open menu when the next target has no actions', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div>
          <main data-stage data-testid="stage" />
          <div data-testid="empty-area">no actions</div>
        </div>
      </GlobalContextMenu>,
      { state: userState, setHideAudioOnlyTiles: vi.fn() }
    );

    fireEvent.contextMenu(screen.getByTestId('stage'));
    expect(await screen.findByText('Ocultar sem vídeo')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    await waitFor(() => {
    expect(screen.queryByText('Ocultar sem vídeo')).not.toBeInTheDocument();
    });
  });

  it('shows "Ver perfil" for a data-user-id target and triggers onOpenProfile with the right id', async () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={onOpenProfile}>
        <div data-user-id="u-42" data-testid="user-row">Fulana</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('user-row'));
    const item = await screen.findByText('Ver perfil');
    fireEvent.click(item);

    expect(onOpenProfile).toHaveBeenCalledWith('u-42');
  });

  describe('a message\'s menu', () => {
    const message = { msgId: 7, conversationId: 'c1', id: 'other', name: 'Ana', avatar: '', text: 'oi', ts: 1 } as never;
    const room = (overrides: Record<string, unknown> = {}) => ({
      state: userState,
      activeConversationId: 'c1',
      messagesByConversation: new Map([['c1', [message]]]),
      reactToChatMessage: vi.fn(),
      ...overrides,
    });
    const renderMessage = (overrides: Record<string, unknown> = {}) => renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <p data-message-id="7" data-testid="msg">oi</p>
      </GlobalContextMenu>,
      room(overrides),
    );

    it('opens with quick reactions and a "+", without the emoji picker', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));

      expect(await screen.findByRole('button', { name: 'Reagir com 👍' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mais emojis' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/buscar/i)).not.toBeInTheDocument();
      expect(screen.getByText('Responder')).toBeInTheDocument();
    });

    it('clicking a quick reaction reacts and closes the menu', async () => {
      const react = vi.fn();
      renderMessage({ reactToChatMessage: react });
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByRole('button', { name: 'Reagir com ❤️' }));

      expect(react).toHaveBeenCalledWith(7, '❤️');
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Mais emojis' })).not.toBeInTheDocument());
    });

    it('the "+" swaps the quick reactions for the full picker', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByRole('button', { name: 'Mais emojis' }));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reagir com 👍' })).not.toBeInTheDocument());
      expect(document.querySelector('[data-slot="emoji-picker"]')).toBeInTheDocument();
    });

    it('does not offer "Ver todas as reações" when the message has none', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));
      await screen.findByText('Responder');
      expect(screen.queryByText('Ver todas as reações')).not.toBeInTheDocument();
    });

    it('"Ver todas as reações" opens the dialog with the right conversation and message', async () => {
      const openReactionParticipants = vi.fn();
      const reacted = { msgId: 7, conversationId: 'c1', id: 'other', name: 'Ana', avatar: '', text: 'oi', ts: 1, reactions: { '👍': ['other'] } } as never;
      renderMessage({ openReactionParticipants, messagesByConversation: new Map([['c1', [reacted]]]) });
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByText('Ver todas as reações'));

      expect(openReactionParticipants).toHaveBeenCalledWith({ conversationId: 'c1', msgId: 7 });
    });
  });
});
