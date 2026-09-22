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
  it('nao abre popup vazio quando o alvo nao tem nenhuma acao', () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div data-testid="empty-area">sem acoes</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    expect(document.querySelector('[data-slot="context-menu-content"]')).not.toBeInTheDocument();
  });

  it('continua abrindo quando o alvo tem acoes visiveis', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <main data-stage data-testid="stage" />
      </GlobalContextMenu>,
      { state: userState, setHideAudioOnlyTiles: vi.fn() }
    );

    fireEvent.contextMenu(screen.getByTestId('stage'));

    expect(await screen.findByText('Ocultar sem vídeo')).toBeInTheDocument();
  });

  it('fecha o menu aberto quando o proximo alvo nao tem acoes', async () => {
    renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <div>
          <main data-stage data-testid="stage" />
          <div data-testid="empty-area">sem acoes</div>
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

  it('mostra "Ver perfil" para um alvo data-user-id e aciona onOpenProfile com o id certo', async () => {
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

  describe('menu de uma mensagem', () => {
    const message = { msgId: 7, id: 'other', name: 'Ana', avatar: '', text: 'oi', ts: 1 } as never;
    const room = (reactToChatMessage = vi.fn()) => ({
      state: userState,
      activeConversationId: 'c1',
      messagesByConversation: new Map([['c1', [message]]]),
      reactToChatMessage,
    });
    const renderMessage = (reactToChatMessage = vi.fn()) => renderWithRoom(
      <GlobalContextMenu onOpenProfile={vi.fn()}>
        <p data-message-id="7" data-testid="msg">oi</p>
      </GlobalContextMenu>,
      room(reactToChatMessage),
    );

    it('abre com reacoes rapidas e um "+", sem o seletor de emoji', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));

      expect(await screen.findByRole('button', { name: 'Reagir com 👍' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mais emojis' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/buscar/i)).not.toBeInTheDocument();
      expect(screen.getByText('Responder')).toBeInTheDocument();
    });

    it('clicar numa reacao rapida reage e fecha o menu', async () => {
      const react = vi.fn();
      renderMessage(react);
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByRole('button', { name: 'Reagir com ❤️' }));

      expect(react).toHaveBeenCalledWith(7, '❤️');
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Mais emojis' })).not.toBeInTheDocument());
    });

    it('o "+" troca as reacoes rapidas pelo seletor completo', async () => {
      renderMessage();
      fireEvent.contextMenu(screen.getByTestId('msg'));
      fireEvent.click(await screen.findByRole('button', { name: 'Mais emojis' }));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reagir com 👍' })).not.toBeInTheDocument());
      expect(document.querySelector('[data-slot="emoji-picker"]')).toBeInTheDocument();
    });
  });
});
