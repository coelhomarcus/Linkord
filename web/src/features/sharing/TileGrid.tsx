import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoom } from '../../state/RoomContext';
import { Tile } from './Tile';
import type { TileDescriptor } from './tileTypes';

interface TileGridProps {
  descriptors: TileDescriptor[];
  focusedId: string | null;
}

// tamanho fixo da tira de miniaturas do modo foco — sem fr/minmax aqui de
// proposito (ver comentario grande abaixo).
const THUMB_W = 160;
const THUMB_H = 90;

// todo tile da grade (sem foco) mantem essa proporcao — nunca estica pra
// quadrado, nem quando sobra espaco (o video em si ja usa object-cover,
// ver Tile.tsx, entao cortar o excesso pra caber nessa caixa e esperado).
const TILE_ASPECT_RATIO = 16 / 9;
const GRID_GAP = 12; // px — precisa bater com gap-3 (0.75rem = 12px)

/** Quantas pessoas "fingir" que tem, so pra efeito de TAMANHO do tile — com
 * so 2 ou 3 na chamada, dimensionar como se fossem exatamente essas 2/3
 * deixava os tiles enormes e quase quadrados (cada um vira metade da tela).
 * Sozinha (1) continua tratada como 1 mesmo — nesse caso GRANDE e o
 * comportamento certo, nao teria sentido fingir 4 e encolher a pessoa. De 2
 * a 4, sempre dimensiona como se fossem 4 (a mesma grade 2x2); a partir de
 * 5, cada pessoa a mais so aumenta a grade de verdade. */
function referenceCount(n: number): number {
  if (n <= 1) return n;
  return Math.max(n, 4);
}

/** Maior tile (respeitando TILE_ASPECT_RATIO) que cabe em `cols` colunas por
 * `rows` linhas dentro do espaco disponivel — testa contra largura E altura,
 * o menor dos dois "vence" (garante que nunca estoura o container). */
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
 * Grade estilo Discord pra quando ninguem esta em foco: colunas = raiz
 * quadrada arredondada pra cima do numero de referencia (ver referenceCount),
 * tiles com proporcao FIXA (nunca esticam pra preencher a celula), cada
 * linha centralizada — inclusive a ultima, incompleta (ex.: 3 pessoas = 2
 * em cima, a 3a sozinha embaixo mas CENTRALIZADA, nao grudada na esquerda).
 * O tamanho do tile e recalculado a cada mudanca de tamanho do container via
 * ResizeObserver (mesma tecnica que Tile.tsx ja usa pro fit="contain").
 *
 * MODO FOCO e outra historia — tentei duas vezes manter o tile principal
 * (grid-column: 1/-1, ocupando todas as colunas) e a tira de miniaturas no
 * MESMO conjunto de colunas (via minmax(var(--thumb-w),1fr) e depois
 * minmax(160px,1fr)) e as duas vezes a tira ficou espremida. A causa: pedir
 * "colunas estreitas o bastante pra caber varias miniaturas pequenas" E
 * "essas mesmas colunas, somadas, tem que dar a largura TOTAL da tela pro
 * tile principal" sao dois requisitos que se contradizem — quando o grid
 * tem poucas colunas (poucas miniaturas), cada coluna "1fr" fica enorme
 * pra fechar a largura total, e a miniatura (limitada por max-width)
 * fica pequena dentro dela; quando tem muitas colunas, o piso de cada
 * uma some porque o grid inteiro tenta caber na largura disponivel de
 * qualquer jeito. Resolvido separando estruturalmente: o tile principal
 * vira um <div flex-1> comum (largura 100% de verdade, sem depender de
 * span de coluna nenhuma) e a tira de miniaturas e uma linha flex
 * SEPARADA embaixo, com largura FIXA por item (sem fr, sem minmax) e
 * overflow-x-auto nativo — não tem negociação de espaço nenhuma pra dar
 * errado.
 */
export function TileGrid({ descriptors, focusedId }: TileGridProps) {
  const { state } = useRoom();
  const keys = useMemo(() => descriptors.map((d) => d.key), [descriptors]);
  const focus = focusedId && keys.includes(focusedId) ? focusedId : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (focus) return; // so precisa medir no modo grade
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
                {/* avatarSize menor: o default (80px) pensado pra tile
                    grande ficava quase do tamanho da miniatura inteira
                    (90px de altura) quando a camera esta desligada. */}
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
