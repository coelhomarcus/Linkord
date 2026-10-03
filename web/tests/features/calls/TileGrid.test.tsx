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
    paused: false,
  }));
}

describe('TileGrid', () => {
  it('flat list: each tile is a direct child of the grid, no row wrapper', () => {
    const { container } = renderWithRoom(<TileGrid descriptors={descriptors(5)} focusedId={null} />);
    const grid = container.querySelector('[data-tile-grid]');

    expect(grid?.children).toHaveLength(5);
    expect(container.querySelectorAll('[data-tile-row]')).toHaveLength(0);
  });

  it('the normal grid uses centered flex-wrap (CSS handles centering the last row, no JS grouping by row)', () => {
    const { container } = renderWithRoom(<TileGrid descriptors={descriptors(5)} focusedId={null} />);
    const grid = container.querySelector('[data-tile-grid]');

    expect(grid).toHaveClass('flex', 'flex-wrap', 'justify-center');
  });

  it('changing the tile count does not remount the ones that already existed (same DOM node, just one parent)', () => {
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

  it.each([2, 3, 5])('focus mode shows the main tile and all %i thumbnails (flat list, no rows via JS)', (thumbnailCount) => {
    const all = descriptors(thumbnailCount + 1);
    const { container, getByTestId } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);

    expect(getByTestId(`tile-${all[0]!.participantId}`)).toBeInTheDocument();
    const strip = container.querySelector('[data-thumb-strip]');
    expect(strip?.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(thumbnailCount);
    expect(container.querySelectorAll('[data-tile-row]')).toHaveLength(0);
  });

  it('the thumbnail strip has a fixed max height (does not grow unbounded and squeeze the main tile)', () => {
    const all = descriptors(9);
    const { container } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    const strip = container.querySelector('[data-thumb-strip]') as HTMLElement;

    expect(strip.style.maxHeight).toBeTruthy();
    expect(strip.className).toContain('overflow-y-auto');
  });

  it('the thumbnail strip is collapsible', async () => {
    const user = userEvent.setup();
    const all = descriptors(3);
    const { container, getByRole } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);

    expect(container.querySelector('[data-thumb-strip]')).toBeInTheDocument();
    await user.click(getByRole('button', { name: 'Ocultar participantes' }));
    expect(container.querySelector('[data-thumb-strip]')).not.toBeInTheDocument();
    await user.click(getByRole('button', { name: 'Mostrar participantes' }));
    expect(container.querySelector('[data-thumb-strip]')).toBeInTheDocument();
  });

  it('without thumbnails (alone in focus), does not show the collapse control', () => {
    const all = descriptors(1);
    const { queryByRole } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    expect(queryByRole('button', { name: /participantes/ })).not.toBeInTheDocument();
  });

  it('normal grid tiles use contain by default (never crop camera/screen) and stay centered in the cell', () => {
    const { container, getByTestId } = renderWithRoom(<TileGrid descriptors={descriptors(2)} focusedId={null} />);
    expect(getByTestId('tile-p-0')).toHaveAttribute('data-fit', 'contain');
    const wrapper = container.querySelector('[data-testid="tile-p-0"]')?.parentElement;
    expect(wrapper).toHaveClass('items-center', 'justify-center');
  });

  it('the focused tile also uses contain', () => {
    const all = descriptors(2);
    const { getByTestId } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    expect(getByTestId(`tile-${all[0]!.participantId}`)).toHaveAttribute('data-fit', 'contain');
  });

  it('secondary strip thumbnails keep using cover (small preview, cropping fills better)', () => {
    const all = descriptors(2);
    const { container, getByTestId } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);
    const thumbTestId = `tile-${all[1]!.participantId}`;
    expect(getByTestId(thumbTestId)).toHaveAttribute('data-fit', 'cover');
    const wrapper = container.querySelector(`[data-testid="${thumbTestId}"]`)?.parentElement;
    expect(wrapper).not.toHaveClass('items-center');
  });

  it('focuses the camera and screen of the SAME person independently (distinct keys per source)', () => {
    const camera: TileDescriptor = { key: 'u1:participant', participantId: 'u1', kind: 'camera', loading: false, paused: false };
    const screen: TileDescriptor = { key: 'u1:screen', participantId: 'u1', kind: 'screen', loading: false, paused: false };

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

describe('TileGrid — onCapacityChange', () => {
  it('reports meetsMinimum=true when tiles fit within the default minTileWidth', () => {
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={descriptors(2)} focusedId={null} onCapacityChange={onCapacityChange} />);
    expect(onCapacityChange).toHaveBeenCalledWith(true, 'p-0:avatar');
  });

  it('reports meetsMinimum=false when the required minTileWidth does not fit (fake container is 600x600)', () => {
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={descriptors(9)} focusedId={null} minTileWidth={1000} onCapacityChange={onCapacityChange} />);
    expect(onCapacityChange).toHaveBeenCalledWith(false, 'p-0:avatar');
  });

  it('without descriptors, does not call onCapacityChange (nothing to fit)', () => {
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={[]} focusedId={null} onCapacityChange={onCapacityChange} />);
    expect(onCapacityChange).not.toHaveBeenCalled();
  });
});
