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
    if (focus) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [focus]);

  const isMine = (participantId: string) => participantId === state.me.id;

  if (focus) {
    const focusedDescriptor = descriptors.find((d) => d.key === focus);
    const thumbs = descriptors.filter((d) => d.key !== focus);
    if (!focusedDescriptor) return null;
    return (
      <div className="flex h-full w-full flex-col gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <Tile
            participantId={focusedDescriptor.participantId}
            kind={focusedDescriptor.kind}
            isMine={isMine(focusedDescriptor.participantId)}
            fit="contain"
            avatarSize={104}
            nameSize="label"
          />
        </div>
        {thumbs.length > 0 && (
          <div className="flex flex-none justify-center gap-3 overflow-x-auto pb-0.5">
            {thumbs.map((d) => (
              <div key={d.key} style={{ width: THUMB_W, height: THUMB_H }} className="flex-none">
                <Tile participantId={d.participantId} kind={d.kind} isMine={isMine(d.participantId)} avatarSize={32} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const n = descriptors.length;
  const refN = referenceCount(n);
  const cols = Math.max(1, Math.ceil(Math.sqrt(refN || 1)));
  const refRows = Math.max(1, Math.ceil(refN / cols));
  const { tileW, tileH } = fitTileSize(cols, refRows, containerSize.w, containerSize.h);

  const rows: TileDescriptor[][] = [];
  for (let i = 0; i < descriptors.length; i += cols) rows.push(descriptors.slice(i, i + cols));

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col items-center justify-center gap-3">
      {rows.map((rowItems, ri) => (
        <div key={ri} className="flex justify-center gap-3">
          {rowItems.map((d) => (
            <div key={d.key} style={{ width: tileW, height: tileH }} className="flex-none">
              <Tile participantId={d.participantId} kind={d.kind} isMine={isMine(d.participantId)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
