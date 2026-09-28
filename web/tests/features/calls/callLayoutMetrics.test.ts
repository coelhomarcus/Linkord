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
  it('segue a tabela de referência (12 abaixo de 6, depois 10/8/6/4)', () => {
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
  it('container invalido (zero/negativo) nao gera NaN nem quebra, so retorna null', () => {
    expect(fitGrid(4, 0, 600, 220)).toBeNull();
    expect(fitGrid(4, 800, 0, 220)).toBeNull();
    expect(fitGrid(4, -100, 600, 220)).toBeNull();
    expect(fitGrid(0, 800, 600, 220)).toBeNull();
  });

  it('1 fonte usa a maior area possivel (1 coluna, 1 linha)', () => {
    const fit = fitGrid(1, 1200, 700, 220);
    expect(fit).toMatchObject({ cols: 1, rows: 1 });
    expect(fit!.tileW).toBeGreaterThan(0);
  });

  it.each([2, 3, 4, 5, 9, 16])('%i fontes: sempre cabem todas (cols*rows >= n) e sem NaN', (n) => {
    const fit = fitGrid(n, 1200, 700, 220);
    expect(fit).not.toBeNull();
    expect(fit!.cols * fit!.rows).toBeGreaterThanOrEqual(n);
    expect(Number.isFinite(fit!.tileW)).toBe(true);
    expect(Number.isFinite(fit!.tileH)).toBe(true);
    expect(fit!.tileW).toBeGreaterThan(0);
    expect(fit!.tileH).toBeGreaterThan(0);
  });

  it('3 fontes: a busca por candidatos bate a heuristica antiga de "pelo menos 4" (mais que o dobro de area num container largo e baixo)', () => {
    const containerW = 1600;
    const containerH = 400;
    const gap = gridGap(3);
    const fit = fitGrid(3, containerW, containerH, 220);
    const newArea = fit!.tileW * fit!.tileH;
    const oldArea = oldHeuristicArea(3, containerW, containerH, gap);

    expect(fit!.cols).toBe(3); // 3 lado a lado bate melhor nesse container largo e baixo
    expect(newArea).toBeGreaterThan(oldArea * 2);
  });

  it('2 fontes num container estreito e alto: empilhar (1 coluna) da mais area que forcar lado a lado', () => {
    const fit = fitGrid(2, 300, 900, 100);
    expect(fit!.cols).toBe(1);
    expect(fit!.rows).toBe(2);
  });

  it('2 fontes num container largo: lado a lado da mais area que empilhar', () => {
    const fit = fitGrid(2, 1400, 500, 220);
    expect(fit!.cols).toBe(2);
    expect(fit!.rows).toBe(1);
  });

  it('preserva 16:9 no candidato escolhido', () => {
    const fit = fitGrid(4, 1200, 700, 220);
    expect(fit!.tileW / fit!.tileH).toBeCloseTo(16 / 9, 2);
  });

  it('quando nada atinge o minimo, ainda retorna o melhor candidato (nunca esconde ninguem) e sinaliza meetsMinimum: false', () => {
    // 16 tiles crammed into a tiny box — nothing will reach a 220px minimum
    const fit = fitGrid(16, 300, 300, 220);
    expect(fit).not.toBeNull();
    expect(fit!.meetsMinimum).toBe(false);
    expect(fit!.cols * fit!.rows).toBeGreaterThanOrEqual(16);
  });

  it('quando o melhor candidato atinge o minimo, meetsMinimum e true', () => {
    const fit = fitGrid(2, 1400, 700, 220);
    expect(fit!.meetsMinimum).toBe(true);
  });
});
