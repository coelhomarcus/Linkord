import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoom } from '../../state/RoomContext';
import { Tile } from './Tile';
import type { TileDescriptor } from './tileTypes';

interface TileGridProps {
  descriptors: TileDescriptor[];
  focusedId: string | null;
}

// fixed size for the focus-mode thumbnail strip — no fr/minmax here on
// purpose (see the big comment below).
const THUMB_W = 160;
const THUMB_H = 90;

// every grid tile (non-focus) keeps this ratio — never stretches to a
// square even with room to spare (the video itself already uses
// object-cover, see Tile.tsx, so cropping the excess to fit this box is expected).
const TILE_ASPECT_RATIO = 16 / 9;
const GRID_GAP = 12; // px — must match gap-3 (0.75rem = 12px)

/** How many people to "pretend" there are, purely for tile SIZE — with
 * only 2 or 3 in the call, sizing for exactly that made tiles huge and
 * almost square (each becomes half the screen). Solo (1) still counts as
 * 1 — there LARGE is the right call, no point pretending 4 and shrinking
 * that person. From 2 to 4, always sizes as if there were 4 (the same 2x2
 * grid); from 5 on, each extra person actually grows the grid. */
function referenceCount(n: number): number {
  if (n <= 1) return n;
  return Math.max(n, 4);
}

/** Largest tile (respecting TILE_ASPECT_RATIO) that fits `cols` columns by
 * `rows` rows within the available space — checks against both width AND
 * height, the smaller of the two wins (guarantees it never overflows the
 * container). */
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

/**
 * Discord-style grid for when no one is focused: columns = ceil(sqrt of
 * the reference count, see referenceCount), tiles at a FIXED ratio (never
 * stretch to fill the cell), each row centered — including an incomplete
 * last row (e.g. 3 people = 2 on top, the 3rd alone below but CENTERED,
 * not stuck to the left). Tile size is recalculated on every container
 * resize via ResizeObserver (same technique Tile.tsx already uses for
 * fit="contain").
 *
 * FOCUS MODE is a different story — two attempts at keeping the main tile
 * (grid-column: 1/-1, spanning all columns) and the thumbnail strip in the
 * SAME column set both squeezed the strip. Cause: "columns narrow enough
 * for several small thumbnails" and "those same columns, summed, must
 * equal the full screen width for the main tile" contradict each other —
 * with few columns (few thumbnails) each "1fr" column grows huge to fill
 * the width, shrinking the thumbnail inside it; with many columns, each
 * one's floor disappears as the grid tries to fit the available width
 * regardless. Fixed by splitting them structurally: the main tile becomes
 * a plain <div flex-1> (real 100% width, no column span to depend on) and
 * the thumbnail strip is a SEPARATE flex row below it, fixed width per
 * item (no fr, no minmax) with native overflow-x-auto — nothing left to
 * negotiate that could go wrong.
 */
export function TileGrid({ descriptors, focusedId }: TileGridProps) {
  const { state } = useRoom();
  const keys = useMemo(() => descriptors.map((d) => d.key), [descriptors]);
  const focus = focusedId && keys.includes(focusedId) ? focusedId : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (focus) return; // only needs measuring in grid mode
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
                {/* smaller avatarSize: the default (80px) meant for a large
                    tile was almost as big as the whole thumbnail (90px
                    tall) with the camera off. */}
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
