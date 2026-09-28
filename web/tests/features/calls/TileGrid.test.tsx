import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { TileGrid } from '@/features/calls/TileGrid';

vi.stubGlobal(
  'ResizeObserver',
  class {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      this.callback(
        [{ contentRect: { width: 600, height: 600 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}

    disconnect() {}
  },
);

vi.mock('@/features/calls/Tile', () => ({
  Tile: ({ participantId, fit }: { participantId: string; fit?: string }) => <div data-testid={`tile-${participantId}`} data-fit={fit} />,
}));

function descriptors(count: number): TileDescriptor[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `p-${index}:avatar`,
    participantId: `p-${index}`,
    kind: 'avatar' as const,
    loading: false,
  }));
}

describe('TileGrid', () => {
  it('lista plana: cada tile e filho direto do grid, sem wrapper de linha', () => {
    const { container } = renderWithRoom(<TileGrid descriptors={descriptors(5)} focusedId={null} />);
    const grid = container.querySelector('[data-tile-grid]');

    expect(grid?.children).toHaveLength(5);
    expect(container.querySelectorAll('[data-tile-row]')).toHaveLength(0);
  });

  it('o grid normal usa flex-wrap centralizado (o CSS cuida de centralizar a ultima linha, sem JS agrupando por linha)', () => {
    const { container } = renderWithRoom(<TileGrid descriptors={descriptors(5)} focusedId={null} />);
    const grid = container.querySelector('[data-tile-grid]');

    expect(grid).toHaveClass('flex', 'flex-wrap', 'justify-center');
  });

  it('trocar a quantidade de tiles nao remonta os que ja existiam (mesmo no DOM, so um pai)', () => {
    const value = createFakeRoomContextValue();
    const { container, rerender } = renderWithRoom(<TileGrid descriptors={descriptors(3)} focusedId={null} />);
    const firstTileBefore = container.querySelector('[data-testid="tile-p-0"]');

    rerender(
      <RoomContext.Provider value={value}>
        <TileGrid descriptors={descriptors(4)} focusedId={null} />
      </RoomContext.Provider>
    );
    const firstTileAfter = container.querySelector('[data-testid="tile-p-0"]');

    expect(firstTileAfter).toBe(firstTileBefore);
  });

  it.each([2, 3, 5])('modo de foco mostra o tile principal e todas as %i miniaturas (lista plana, sem linhas por JS)', (thumbnailCount) => {
    const all = descriptors(thumbnailCount + 1);
    const { container, getByTestId } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);

    expect(getByTestId(`tile-${all[0]!.participantId}`)).toBeInTheDocument();
    const strip = container.querySelector('[data-thumb-strip]');
    expect(strip?.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(thumbnailCount);
    expect(container.querySelectorAll('[data-tile-row]')).toHaveLength(0);
  });

  it('a faixa de miniaturas tem altura maxima fixa (nao cresce sem limite e esmaga o principal)', () => {
    const all = descriptors(9);
    const { container } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    const strip = container.querySelector('[data-thumb-strip]') as HTMLElement;

    expect(strip.style.maxHeight).toBeTruthy();
    expect(strip.className).toContain('overflow-y-auto');
  });

  it('a faixa de miniaturas e recolhivel', async () => {
    const user = userEvent.setup();
    const all = descriptors(3);
    const { container, getByRole } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);

    expect(container.querySelector('[data-thumb-strip]')).toBeInTheDocument();
    await user.click(getByRole('button', { name: 'Ocultar participantes' }));
    expect(container.querySelector('[data-thumb-strip]')).not.toBeInTheDocument();
    await user.click(getByRole('button', { name: 'Mostrar participantes' }));
    expect(container.querySelector('[data-thumb-strip]')).toBeInTheDocument();
  });

  it('sem miniaturas (sozinho em foco), nao mostra o controle de recolher', () => {
    const all = descriptors(1);
    const { queryByRole } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    expect(queryByRole('button', { name: /participantes/ })).not.toBeInTheDocument();
  });

  it('tiles do grid normal usam contain por padrao (nunca cortam camera/tela) e ficam centralizados na celula', () => {
    const { container, getByTestId } = renderWithRoom(<TileGrid descriptors={descriptors(2)} focusedId={null} />);
    expect(getByTestId('tile-p-0')).toHaveAttribute('data-fit', 'contain');
    const wrapper = container.querySelector('[data-testid="tile-p-0"]')?.parentElement;
    expect(wrapper).toHaveClass('items-center', 'justify-center');
  });

  it('o tile em foco tambem usa contain', () => {
    const all = descriptors(2);
    const { getByTestId } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    expect(getByTestId(`tile-${all[0]!.participantId}`)).toHaveAttribute('data-fit', 'contain');
  });

  it('miniaturas da faixa secundaria continuam em cover (preview pequena, cortar preenche melhor)', () => {
    const all = descriptors(2);
    const { container, getByTestId } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    const thumbTestId = `tile-${all[1]!.participantId}`;
    expect(getByTestId(thumbTestId)).toHaveAttribute('data-fit', 'cover');
    const wrapper = container.querySelector(`[data-testid="${thumbTestId}"]`)?.parentElement;
    expect(wrapper).not.toHaveClass('items-center');
  });

  it('foca a camera e a tela da MESMA pessoa de forma independente (chaves distintas por fonte)', () => {
    const camera: TileDescriptor = { key: 'u1:participant', participantId: 'u1', kind: 'camera', loading: false };
    const screen: TileDescriptor = { key: 'u1:screen', participantId: 'u1', kind: 'screen', loading: false };

    // focusing the camera key: the main slot gets one tile, the strip gets
    // the other — proving the two sources of the same person are tracked
    // (and focusable) independently, not merged into one "u1" identity
    const onCamera = renderWithRoom(<TileGrid descriptors={[camera, screen]} focusedId="u1:participant" />);
    expect(onCamera.container.querySelectorAll('[data-testid="tile-u1"]')).toHaveLength(2);
    expect(onCamera.container.querySelector('[data-thumb-strip] [data-testid="tile-u1"]')).toBeInTheDocument();
    onCamera.unmount();

    // focusing the screen key instead: still exactly one main + one strip tile
    const onScreen = renderWithRoom(<TileGrid descriptors={[camera, screen]} focusedId="u1:screen" />);
    expect(onScreen.container.querySelectorAll('[data-testid="tile-u1"]')).toHaveLength(2);
    expect(onScreen.container.querySelector('[data-thumb-strip] [data-testid="tile-u1"]')).toBeInTheDocument();
  });
});
