const ASPECT_RATIO = 16 / 9;

export interface GridFit {
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  /** False when even the best-fitting candidate falls under the minimum
   * tile width — a signal to switch to focus mode (see the calls redesign
   * plan's E6), never a reason to hide anyone here: fitGrid always returns
   * its best candidate regardless. */
  meetsMinimum: boolean;
}

/** Gaps shrink as the call gets more crowded — tiles are already small by
 * then, so tighter spacing reads better than the same fixed gap eating an
 * ever-larger share of a shrinking tile. Mirrors the reference's schedule. */
export function gridGap(n: number): number {
  if (n >= 40) return 4;
  if (n >= 24) return 6;
  if (n >= 12) return 8;
  if (n >= 6) return 10;
  return 12;
}

function tileSizeForColumns(cols: number, rows: number, containerW: number, containerH: number, gap: number): { tileW: number; tileH: number } {
  const widthConstrainedW = (containerW - gap * (cols - 1)) / cols;
  const widthConstrainedH = widthConstrainedW / ASPECT_RATIO;
  const heightConstrainedH = (containerH - gap * (rows - 1)) / rows;
  const heightConstrainedW = heightConstrainedH * ASPECT_RATIO;
  // whichever axis runs out of room first sets the actual tile size
  return widthConstrainedH <= heightConstrainedH
    ? { tileW: widthConstrainedW, tileH: widthConstrainedH }
    : { tileW: heightConstrainedW, tileH: heightConstrainedH };
}

/** The column count (1..n) that gives every one of `n` tiles the largest
 * possible area at a fixed 16:9, inside containerW x containerH — tried
 * exhaustively rather than assumed, so 2 or 3 participants get tiles sized
 * for 2 or 3, not for a hardcoded reference count of (at least) 4. Prefers
 * candidates that meet `minTileW`; if none do, still returns the largest
 * candidate overall (`meetsMinimum: false`) instead of nothing. */
export function fitGrid(n: number, containerW: number, containerH: number, minTileW: number): GridFit | null {
  if (n <= 0 || containerW <= 0 || containerH <= 0) return null;
  const gap = gridGap(n);
  const candidates: GridFit[] = [];
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const { tileW, tileH } = tileSizeForColumns(cols, rows, containerW, containerH, gap);
    if (tileW <= 0 || tileH <= 0) continue;
    candidates.push({ cols, rows, tileW, tileH, meetsMinimum: tileW >= minTileW });
  }
  if (!candidates.length) return null;
  const valid = candidates.filter((c) => c.meetsMinimum);
  const pool = valid.length ? valid : candidates;
  return pool.reduce((best, c) => (c.tileW * c.tileH > best.tileW * best.tileH ? c : best));
}
