import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { FloatingPip } from '@/features/calls/FloatingPip';
import { useCallTiles } from '@/features/calls/useCallTiles';
import type { TileDescriptor } from '@/features/calls/tileTypes';

vi.mock('@/features/calls/useCallTiles', () => ({ useCallTiles: vi.fn() }));

vi.mock('@/features/calls/Tile', () => ({
  Tile: ({ participantId, kind, paused }: { participantId: string; kind: string; paused?: boolean }) => (
    <div data-testid="pip-tile" data-participant={participantId} data-kind={kind} data-paused={paused ? '1' : '0'} />
  ),
}));

function descriptor(overrides: Partial<TileDescriptor> = {}): TileDescriptor {
  return { key: 'p-2:screen', participantId: 'p-2', kind: 'screen', loading: false, paused: false, ...overrides };
}

function currentTile() {
  return screen.getByTestId('pip-tile');
}

describe('FloatingPip — selecao por identidade estavel', () => {
  it('audio-only (sem descritores nao-avatar): nao renderiza nada', () => {
    vi.mocked(useCallTiles).mockReturnValue([]);
    const { container } = renderWithRoom(<FloatingPip allIds={['p-1', 'p-2']} />);
    expect(container.querySelector('[data-testid="pip-tile"]')).not.toBeInTheDocument();
  });

  it('sem foco e sem escolha manual, mostra o primeiro descritor disponivel', () => {
    vi.mocked(useCallTiles).mockReturnValue([
      descriptor({ key: 'p-2:screen', participantId: 'p-2', kind: 'screen' }),
      descriptor({ key: 'p-3:participant', participantId: 'p-3', kind: 'camera' }),
    ]);
    renderWithRoom(<FloatingPip allIds={['p-2', 'p-3']} />);
    expect(currentTile()).toHaveAttribute('data-participant', 'p-2');
  });

  it('prioriza a fonte em FOCO sobre o primeiro da lista', () => {
    vi.mocked(useCallTiles).mockReturnValue([
      descriptor({ key: 'p-2:screen', participantId: 'p-2', kind: 'screen' }),
      descriptor({ key: 'p-3:participant', participantId: 'p-3', kind: 'camera' }),
    ]);
    renderWithRoom(<FloatingPip allIds={['p-2', 'p-3']} />, {
      state: { ...initialRoomState, focusedId: 'p-3:participant' },
    });
    expect(currentTile()).toHaveAttribute('data-participant', 'p-3');
  });

  it('escolha manual (proxima/anterior) tem prioridade sobre o foco automatico', () => {
    vi.mocked(useCallTiles).mockReturnValue([
      descriptor({ key: 'p-2:screen', participantId: 'p-2', kind: 'screen' }),
      descriptor({ key: 'p-3:participant', participantId: 'p-3', kind: 'camera' }),
    ]);
    renderWithRoom(<FloatingPip allIds={['p-2', 'p-3']} />, {
      state: { ...initialRoomState, focusedId: 'p-2:screen' },
    });
    expect(currentTile()).toHaveAttribute('data-participant', 'p-2');

    fireEvent.click(screen.getByLabelText('Próxima transmissão'));
    expect(currentTile()).toHaveAttribute('data-participant', 'p-3');
  });

  it('quando a escolha manual desaparece da lista, volta a seguir o foco (fallback valido, nunca um indice morto)', () => {
    const value = createFakeRoomContextValue({ state: { ...initialRoomState, focusedId: 'p-3:participant' } });
    vi.mocked(useCallTiles).mockReturnValue([
      descriptor({ key: 'p-2:screen', participantId: 'p-2', kind: 'screen' }),
      descriptor({ key: 'p-3:participant', participantId: 'p-3', kind: 'camera' }),
    ]);
    const { rerender } = renderWithRoom(<FloatingPip allIds={['p-2', 'p-3']} />, value);

    // manually pick the OTHER descriptor (p-2), away from the focused one
    fireEvent.click(screen.getByLabelText('Transmissão anterior'));
    expect(currentTile()).toHaveAttribute('data-participant', 'p-2');

    // p-2's screen disappears entirely from the list — the manual pick has
    // nothing left to point at, so it must fall back to the focused source
    // (p-3), never a stale index into whatever remains.
    vi.mocked(useCallTiles).mockReturnValue([
      descriptor({ key: 'p-3:participant', participantId: 'p-3', kind: 'camera' }),
    ]);
    rerender(
      <RoomContext.Provider value={value}>
        <FloatingPip allIds={['p-2', 'p-3']} />
      </RoomContext.Provider>
    );
    expect(currentTile()).toHaveAttribute('data-participant', 'p-3');
  });

  it('passa "paused" adiante pro Tile', () => {
    vi.mocked(useCallTiles).mockReturnValue([descriptor({ paused: true })]);
    renderWithRoom(<FloatingPip allIds={['p-2']} />);
    expect(currentTile()).toHaveAttribute('data-paused', '1');
  });
});

describe('FloatingPip — clique vs. arraste', () => {
  it('clique simples (sem movimento) chama onExpand', () => {
    vi.mocked(useCallTiles).mockReturnValue([descriptor()]);
    const onExpand = vi.fn();
    renderWithRoom(<FloatingPip allIds={['p-2']} onExpand={onExpand} />);
    const dragHandle = currentTile().parentElement!.nextElementSibling!;

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(document);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('arrastar alem do limiar NAO chama onExpand', () => {
    vi.mocked(useCallTiles).mockReturnValue([descriptor()]);
    const onExpand = vi.fn();
    renderWithRoom(<FloatingPip allIds={['p-2']} onExpand={onExpand} />);
    const dragHandle = currentTile().parentElement!.nextElementSibling!;

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { clientX: 140, clientY: 100 });
    fireEvent.pointerUp(document);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('pointercancel apos um arraste tambem nao chama onExpand', () => {
    vi.mocked(useCallTiles).mockReturnValue([descriptor()]);
    const onExpand = vi.fn();
    renderWithRoom(<FloatingPip allIds={['p-2']} onExpand={onExpand} />);
    const dragHandle = currentTile().parentElement!.nextElementSibling!;

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { clientX: 140, clientY: 100 });
    fireEvent.pointerCancel(document);
    expect(onExpand).not.toHaveBeenCalled();
  });
});
