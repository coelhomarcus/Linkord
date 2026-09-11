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
  const { tileW, tileH } = fitTileSize(cols, refRows, containerSize.w, containerSize.h);
  const thumbs = focus ? descriptors.filter((d) => d.key !== focus) : [];
  const thumbCols = focus ? Math.max(1, Math.floor((containerSize.w + GRID_GAP) / (THUMB_W + GRID_GAP))) : 1;
  const thumbRows = focus ? Math.max(1, Math.ceil(thumbs.length / thumbCols)) : 1;
  const gridTemplateColumns = focus
    ? `repeat(${thumbCols}, minmax(0, 1fr))`
    : `repeat(${cols}, ${tileW}px)`;
  const gridTemplateRows = focus
    ? (thumbs.length ? `minmax(0, 1fr) repeat(${thumbRows}, ${THUMB_H}px)` : 'minmax(0, 1fr)')
    : `repeat(${refRows}, ${tileH}px)`;
  let thumbnailIndex = 0;

  return (
    <div
      ref={containerRef}
      className={`grid h-full w-full gap-3 ${focus ? 'items-center justify-items-center' : 'place-content-center'}`}
      style={{ gridTemplateColumns, gridTemplateRows }}
    >
      {descriptors.map((d) => {
        const isFocused = d.key === focus;
        const currentThumbnailIndex = isFocused ? -1 : thumbnailIndex++;
        const style = focus
          ? isFocused
            ? { gridColumn: '1 / -1', gridRow: '1', width: '100%', height: '100%' }
            : {
                gridColumn: String((currentThumbnailIndex % thumbCols) + 1),
                gridRow: String(Math.floor(currentThumbnailIndex / thumbCols) + 2),
                width: THUMB_W,
                height: THUMB_H,
              }
          : { width: tileW, height: tileH };

        return (
          <div key={d.key} style={style} className="min-h-0 min-w-0">
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
      })}
    </div>
  );
}
