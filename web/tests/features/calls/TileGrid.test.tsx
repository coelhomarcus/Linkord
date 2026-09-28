import { describe, expect, it, vi } from 'vitest';
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

  it.each([2, 3, 5])('centraliza as miniaturas no modo de foco com %i miniaturas', (thumbnailCount) => {
    const all = descriptors(thumbnailCount + 1);
    const { container } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    const grid = container.querySelector('[data-tile-grid]');
    const rows = Array.from(grid?.children ?? []).filter((child) => child.hasAttribute('data-tile-row'));
    const expectedRowSizes = thumbnailCount === 5 ? [3, 2] : [thumbnailCount];

    expect(grid?.children[0]).toHaveStyle({ gridRow: '1', gridColumn: '1 / -1' });
    expect(grid?.children[0]).toHaveClass('items-center', 'justify-center');
    expect(rows).toHaveLength(expectedRowSizes.length);
    expect(rows.map((row) => row.children.length)).toEqual(expectedRowSizes);
    expect(rows.every((row) => row.getAttribute('style')?.includes('grid-column: 1 / -1'))).toBe(true);
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
});
