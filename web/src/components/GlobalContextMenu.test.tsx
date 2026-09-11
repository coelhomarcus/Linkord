import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '../state/roomReducer';
import { renderWithRoom } from '../test/roomContextFixture';
import { GlobalContextMenu } from './GlobalContextMenu';

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

    expect(await screen.findByText('Ocultar sem video')).toBeInTheDocument();
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
    expect(await screen.findByText('Ocultar sem video')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    await waitFor(() => {
      expect(screen.queryByText('Ocultar sem video')).not.toBeInTheDocument();
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
});
