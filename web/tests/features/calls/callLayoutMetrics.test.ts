import { describe, expect, it } from 'vitest';
import { fitGrid, gridGap } from '@/features/calls/callLayoutMetrics';

// The old heuristic: `referenceCount = max(n, 4)`, `cols = ceil(sqrt(referenceCount))`,
// `rows = ceil(referenceCount / cols)` — always reserved room as if there were
// at least 4 tiles. Used here only to prove fitGrid actually does better.
function oldHeuristicArea(n: number, containerW: number, containerH: number, gap: number): number {
  const referenceCount = n <= 1 ? n : Math.max(n, 4);
  const cols = Math.max(1, Math.ceil(Math.sqrt(referenceCount || 1)));
  const rows = Math.max(1, Math.ceil(referenceCount / cols));
  let tileW = (containerW - gap * (cols - 1)) / cols;
  let tileH = tileW / (16 / 9);
  if (tileH * rows + gap * (rows - 1) > containerH) {
    tileH = (containerH - gap * (rows - 1)) / rows;
    tileW = tileH * (16 / 9);
  }
  return Math.max(0, tileW) * Math.max(0, tileH);
}

describe('gridGap', () => {
  it('follows the reference table (12 below 6, then 10/8/6/4)', () => {
    expect(gridGap(1)).toBe(12);
    expect(gridGap(5)).toBe(12);
    expect(gridGap(6)).toBe(10);
    expect(gridGap(11)).toBe(10);
    expect(gridGap(12)).toBe(8);
    expect(gridGap(23)).toBe(8);
    expect(gridGap(24)).toBe(6);
    expect(gridGap(39)).toBe(6);
    expect(gridGap(40)).toBe(4);
  });
});

describe('fitGrid', () => {
  it('invalid container (zero/negative) does not produce NaN or crash, just returns null', () => {
    expect(fitGrid(4, 0, 600, 220)).toBeNull();
    expect(fitGrid(4, 800, 0, 220)).toBeNull();
    expect(fitGrid(4, -100, 600, 220)).toBeNull();
    expect(fitGrid(0, 800, 600, 220)).toBeNull();
  });

  it('1 source uses the largest possible area (1 column, 1 row)', () => {
    const fit = fitGrid(1, 1200, 700, 220);
    expect(fit).toMatchObject({ cols: 1, rows: 1 });
    expect(fit!.tileW).toBeGreaterThan(0);
  });

  it.each([2, 3, 4, 5, 9, 16])('%i sources: they always all fit (cols*rows >= n) and no NaN', (n) => {
    const fit = fitGrid(n, 1200, 700, 220);
    expect(fit).not.toBeNull();
    expect(fit!.cols * fit!.rows).toBeGreaterThanOrEqual(n);
    expect(Number.isFinite(fit!.tileW)).toBe(true);
    expect(Number.isFinite(fit!.tileH)).toBe(true);
    expect(fit!.tileW).toBeGreaterThan(0);
    expect(fit!.tileH).toBeGreaterThan(0);
  });

  it('3 sources: the candidate search beats the old "at least 4" heuristic (more than double the area in a wide, short container)', () => {
    const containerW = 1600;
    const containerH = 400;
    const gap = gridGap(3);
    const fit = fitGrid(3, containerW, containerH, 220);
    const newArea = fit!.tileW * fit!.tileH;
    const oldArea = oldHeuristicArea(3, containerW, containerH, gap);

    expect(fit!.cols).toBe(3); // 3 side by side fits better in this wide, short container
    expect(newArea).toBeGreaterThan(oldArea * 2);
  });

  it('2 sources in a narrow, tall container: stacking (1 column) gives more area than forcing side by side', () => {
    const fit = fitGrid(2, 300, 900, 100);
    expect(fit!.cols).toBe(1);
    expect(fit!.rows).toBe(2);
  });

  it('2 sources in a wide container: side by side gives more area than stacking', () => {
    const fit = fitGrid(2, 1400, 500, 220);
    expect(fit!.cols).toBe(2);
    expect(fit!.rows).toBe(1);
  });

  it('preserves 16:9 in the chosen candidate', () => {
    const fit = fitGrid(4, 1200, 700, 220);
    expect(fit!.tileW / fit!.tileH).toBeCloseTo(16 / 9, 2);
  });

  it('when nothing reaches the minimum, still returns the best candidate (never hides anyone) and flags meetsMinimum: false', () => {
    // 16 tiles crammed into a tiny box — nothing will reach a 220px minimum
    const fit = fitGrid(16, 300, 300, 220);
    expect(fit).not.toBeNull();
    expect(fit!.meetsMinimum).toBe(false);
    expect(fit!.cols * fit!.rows).toBeGreaterThanOrEqual(16);
  });

  it('when the best candidate reaches the minimum, meetsMinimum is true', () => {
    const fit = fitGrid(2, 1400, 700, 220);
    expect(fit!.meetsMinimum).toBe(true);
  });
});
