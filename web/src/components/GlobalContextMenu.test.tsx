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
      <GlobalContextMenu>
        <div data-testid="empty-area">sem acoes</div>
      </GlobalContextMenu>,
      { state: userState }
    );

    fireEvent.contextMenu(screen.getByTestId('empty-area'));

    expect(document.querySelector('[data-slot="context-menu-content"]')).not.toBeInTheDocument();
  });

  it('continua abrindo quando o alvo tem acoes visiveis', async () => {
    renderWithRoom(
      <GlobalContextMenu>
        <main data-stage data-testid="stage" />
      </GlobalContextMenu>,
      { state: userState, setHideAudioOnlyTiles: vi.fn() }
    );

    fireEvent.contextMenu(screen.getByTestId('stage'));

    expect(await screen.findByText('Ocultar sem video')).toBeInTheDocument();
  });

  it('fecha o menu aberto quando o proximo alvo nao tem acoes', async () => {
    renderWithRoom(
      <GlobalContextMenu>
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
});
