import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Tile } from './Tile';
import { fitGrid, gridGap } from './callLayoutMetrics';
import { cn } from '@/shared/lib/utils';
import type { TileDescriptor } from './tileTypes';

interface TileGridProps {
  descriptors: TileDescriptor[];
  focusedId: string | null;
  /** 220 in the normal grid, 148 in a compact stage (a call sidebar) — see
   * the calls redesign plan §5.2. Below this, fitGrid still returns its
   * best candidate (never hides anyone), just flagged `meetsMinimum: false`
   * for a future caller to act on (switching to focus mode is E6's job). */
  minTileWidth?: number;
}

const THUMB_W = 160;
const THUMB_H = 90;
const DEFAULT_MIN_TILE_WIDTH = 220;
// How many thumbnail rows show before the strip scrolls instead of growing
// — otherwise a big call's secondary strip keeps eating rows until the
// main tile is crushed to nothing (see the plan's "faixa recolhível...
// não acumular linhas que eliminem o principal").
const MAX_VISIBLE_THUMB_ROWS = 2;

export function TileGrid({ descriptors, focusedId, minTileWidth = DEFAULT_MIN_TILE_WIDTH }: TileGridProps) {
  const { state } = useRoom();
  const keys = useMemo(() => descriptors.map((d) => d.key), [descriptors]);
  const focus = focusedId && keys.includes(focusedId) ? focusedId : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isMine = (participantId: string) => participantId === state.me.id;
  const [thumbsCollapsed, setThumbsCollapsed] = useState(false);

  const n = descriptors.length;
  const gridFit = fitGrid(n, containerSize.w, containerSize.h, minTileWidth);
  const thumbs = focus ? descriptors.filter((d) => d.key !== focus) : [];

  // Contain-fit tiles shrink their own root to the media's aspect ratio (see
  // Tile.tsx), so their wrapper has to actively center them — a cover-fit
  // tile (only the thumbnail strip, small previews read fine cropped) fills
  // its wrapper exactly and needs no centering.
  const renderTile = (d: TileDescriptor, isFocused: boolean, width: number | string, height: number | string, fit: 'cover' | 'contain' = 'contain') => (
    <div
      key={d.key}
      style={{ width, height }}
      className={cn('flex-none', fit === 'contain' ? 'flex min-h-0 min-w-0 items-center justify-center' : 'min-h-0 min-w-0')}
    >
      <Tile
        participantId={d.participantId}
        kind={d.kind}
        loading={d.loading}
        paused={d.paused}
        isMine={isMine(d.participantId)}
        fit={fit}
        avatarSize={isFocused ? 104 : focus ? 32 : 96}
        nameSize={isFocused ? 'label' : 'body'}
      />
    </div>
  );

  if (!focus) {
    // A flat list in a single flex-wrap container — no per-row wrapper divs.
    // Each tile keeps the same DOM parent no matter how the tile count (and
    // so the column count) changes, so React never has to unmount/remount
    // one just because it moved from one computed row to another; wrapping
    // a fixed-width flex item also centers an incomplete last row natively.
    return (
      <div
        ref={containerRef}
        data-tile-grid
        className="flex h-full w-full flex-wrap content-center justify-center"
        style={{ gap: gridFit ? gridGap(n) : 0 }}
      >
        {descriptors.map((d) => renderTile(d, false, gridFit?.tileW ?? 0, gridFit?.tileH ?? 0))}
      </div>
    );
  }

  const focusedDescriptor = descriptors.find((d) => d.key === focus);
  // Capped, not measured: the strip scrolls internally past
  // MAX_VISIBLE_THUMB_ROWS instead of growing — a busy call's secondary
  // strip must never keep eating rows until the main tile is crushed.
  const thumbStripMaxHeight = MAX_VISIBLE_THUMB_ROWS * THUMB_H + (MAX_VISIBLE_THUMB_ROWS - 1) * 12;

  return (
    <div ref={containerRef} data-tile-grid className="flex h-full w-full flex-col items-center gap-2">
      {focusedDescriptor && (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {renderTile(focusedDescriptor, true, '100%', '100%')}
        </div>
      )}
      {thumbs.length > 0 && (
        <div className="flex w-full flex-none flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setThumbsCollapsed((v) => !v)}
            aria-expanded={!thumbsCollapsed}
            aria-label={thumbsCollapsed ? 'Mostrar participantes' : 'Ocultar participantes'}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-caption text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
          >
            {thumbsCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {thumbs.length} participante{thumbs.length === 1 ? '' : 's'}
          </button>
          {!thumbsCollapsed && (
            <div data-thumb-strip className="w-full overflow-y-auto" style={{ maxHeight: thumbStripMaxHeight }}>
              <div className="flex flex-wrap justify-center gap-3">
                {thumbs.map((d) => renderTile(d, false, THUMB_W, THUMB_H, 'cover'))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
