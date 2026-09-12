import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoom } from '../../state/RoomContext';
import { Tile } from './Tile';
import type { TileDescriptor } from './tileTypes';

interface TileGridProps {
  descriptors: TileDescriptor[];
  focusedId: string | null;
}

const THUMB_W = 160;
const THUMB_H = 90;

const TILE_ASPECT_RATIO = 16 / 9;
const GRID_GAP = 12;

function referenceCount(n: number): number {
  if (n <= 1) return n;
  return Math.max(n, 4);
}

function fitTileSize(cols: number, rows: number, containerW: number, containerH: number): { tileW: number; tileH: number } {
  if (containerW <= 0 || containerH <= 0) return { tileW: 0, tileH: 0 };
  let tileW = (containerW - GRID_GAP * (cols - 1)) / cols;
  let tileH = tileW / TILE_ASPECT_RATIO;
  if (tileH * rows + GRID_GAP * (rows - 1) > containerH) {
    tileH = (containerH - GRID_GAP * (rows - 1)) / rows;
    tileW = tileH * TILE_ASPECT_RATIO;
  }
  return { tileW: Math.max(0, tileW), tileH: Math.max(0, tileH) };
}

export function TileGrid({ descriptors, focusedId }: TileGridProps) {
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
  const refN = referenceCount(n);
  const cols = Math.max(1, Math.ceil(Math.sqrt(refN || 1)));
  const refRows = Math.max(1, Math.ceil(refN / cols));
  const actualRows = Math.max(1, Math.ceil(n / cols));
  const { tileW, tileH } = fitTileSize(cols, refRows, containerSize.w, containerSize.h);
  const thumbs = focus ? descriptors.filter((d) => d.key !== focus) : [];
  const thumbCols = focus ? Math.max(1, Math.floor((containerSize.w + GRID_GAP) / (THUMB_W + GRID_GAP))) : 1;
  const thumbRows = focus ? Math.max(1, Math.ceil(thumbs.length / thumbCols)) : 1;
  const gridTemplateColumns = focus
    ? `repeat(${thumbCols}, minmax(0, 1fr))`
    : `repeat(${cols}, ${tileW}px)`;
  const gridTemplateRows = focus
    ? (thumbs.length ? `minmax(0, 1fr) repeat(${thumbRows}, ${THUMB_H}px)` : 'minmax(0, 1fr)')
    : `repeat(${actualRows}, ${tileH}px)`;

  const renderTile = (d: TileDescriptor, isFocused: boolean, width: number | string, height: number | string) => (
    <div key={d.key} style={{ width, height }} className="min-h-0 min-w-0">
      <Tile
        participantId={d.participantId}
        kind={d.kind}
        isMine={isMine(d.participantId)}
        fit={isFocused ? 'contain' : 'cover'}
        avatarSize={isFocused ? 104 : focus ? 32 : 96}
        nameSize={isFocused ? 'label' : 'body'}
      />
    </div>
  );

  if (!focus) {
    const rows: TileDescriptor[][] = [];
    for (let index = 0; index < descriptors.length; index += cols) {
      rows.push(descriptors.slice(index, index + cols));
    }

    return (
      <div
        ref={containerRef}
        data-tile-grid
        className="grid h-full w-full place-content-center gap-3"
        style={{ gridTemplateColumns, gridTemplateRows }}
      >
        {rows.map((row, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            data-tile-row
            style={{ gridColumn: '1 / -1', gridRow: String(rowIndex + 1) }}
            className="flex min-h-0 min-w-0 justify-center gap-3"
          >
            {row.map((d) => renderTile(d, false, tileW, tileH))}
          </div>
        ))}
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
        <div style={{ gridColumn: '1 / -1', gridRow: '1', width: '100%', height: '100%' }} className="min-h-0 min-w-0">
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
          {row.map((d) => renderTile(d, false, THUMB_W, THUMB_H))}
        </div>
      ))}
    </div>
  );
}
