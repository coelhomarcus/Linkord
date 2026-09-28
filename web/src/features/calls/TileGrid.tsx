import { useEffect, useMemo, useRef, useState } from 'react';
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
const GRID_GAP = 12;
const DEFAULT_MIN_TILE_WIDTH = 220;

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

  const n = descriptors.length;
  const gridFit = fitGrid(n, containerSize.w, containerSize.h, minTileWidth);
  const thumbs = focus ? descriptors.filter((d) => d.key !== focus) : [];
  const thumbCols = focus ? Math.max(1, Math.floor((containerSize.w + GRID_GAP) / (THUMB_W + GRID_GAP))) : 1;
  const thumbRows = focus ? Math.max(1, Math.ceil(thumbs.length / thumbCols)) : 1;
  const gridTemplateColumns = `repeat(${thumbCols}, minmax(0, 1fr))`;
  const gridTemplateRows = thumbs.length ? `minmax(0, 1fr) repeat(${thumbRows}, ${THUMB_H}px)` : 'minmax(0, 1fr)';

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
  const thumbnailRows: TileDescriptor[][] = [];
  for (let index = 0; index < thumbs.length; index += thumbCols) {
    thumbnailRows.push(thumbs.slice(index, index + thumbCols));
  }

  return (
    <div
      ref={containerRef}
      data-tile-grid
      className="grid h-full w-full items-center justify-items-center gap-3"
      style={{ gridTemplateColumns, gridTemplateRows }}
    >
      {focusedDescriptor && (
        <div style={{ gridColumn: '1 / -1', gridRow: '1', width: '100%', height: '100%' }} className="flex min-h-0 min-w-0 items-center justify-center">
          {renderTile(focusedDescriptor, true, '100%', '100%')}
        </div>
      )}
      {thumbnailRows.map((row, rowIndex) => (
        <div
          key={`thumbnail-row-${rowIndex}`}
          data-tile-row
          style={{ gridColumn: '1 / -1', gridRow: String(rowIndex + 2) }}
          className="flex min-h-0 min-w-0 justify-center gap-3"
        >
          {row.map((d) => renderTile(d, false, THUMB_W, THUMB_H, 'cover'))}
        </div>
      ))}
    </div>
  );
}
