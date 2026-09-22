import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { Tile } from './Tile';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

interface DragPos {
  x: number;
  y: number;
}

interface FloatingPipProps {
  allIds: string[];
  /** Called on a plain click/tap (not a drag) — returns to the full call view. */
  onExpand?: () => void;
}

export function FloatingPip({ allIds, onExpand }: FloatingPipProps) {
  const { state } = useRoom();
  const descriptors = useCallTiles(allIds).filter((d) => d.kind !== 'avatar');
  const [index, setIndex] = useState(0);
  const [dragPos, setDragPos] = useState<DragPos | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const didDragRef = useRef(false);

  const safeIndex = descriptors.length ? Math.min(index, descriptors.length - 1) : 0;
  const current = descriptors[safeIndex];

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const box = boxRef.current;
    const parent = box?.parentElement;
    if (!box || !parent) return;
    const boxRect = box.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: boxRect.left - parentRect.left,
      top: boxRect.top - parentRect.top,
    };
    didDragRef.current = false;
    setIsDragging(true);
  }

  useEffect(() => {
    if (!isDragging) return;
    function handleMove(e: PointerEvent) {
      const box = boxRef.current;
      const parent = box?.parentElement;
      if (!box || !parent) return;
      const parentRect = parent.getBoundingClientRect();
      const { x, y, left, top } = dragStartRef.current;
      if (Math.abs(e.clientX - x) > 4 || Math.abs(e.clientY - y) > 4) didDragRef.current = true;
      const nextLeft = Math.min(Math.max(0, left + (e.clientX - x)), Math.max(0, parentRect.width - box.offsetWidth));
      const nextTop = Math.min(Math.max(0, top + (e.clientY - y)), Math.max(0, parentRect.height - box.offsetHeight));
      setDragPos({ x: nextLeft, y: nextTop });
    }
    function stop() {
      setIsDragging(false);
      if (!didDragRef.current) onExpand?.();
    }
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
  }, [isDragging, onExpand]);

  // Audio-only call (nobody's camera/screen is on) — nothing to preview.
  // The rail's own green phone icon (AppNavigationRail) is the "in a call"
  // indicator and way back for this case; a floating pill duplicated it.
  if (!current) return null;

  return createPortal(
    <div
      ref={boxRef}
      className={cn(
        'fixed z-30 aspect-video w-36 overflow-hidden rounded-xl shadow-popover ring-1 ring-foreground/10 md:w-64',
        !dragPos && (state.reconnecting ? 'bottom-20 left-4' : 'bottom-4 left-4')
      )}
      style={dragPos ? { left: dragPos.x, top: dragPos.y } : undefined}
    >
      <div className="pointer-events-none absolute inset-0">
        <Tile participantId={current.participantId} kind={current.kind} isMine={current.participantId === state.me.id} />
      </div>
      <div onPointerDown={handlePointerDown} className="absolute inset-0 cursor-move touch-none select-none" />

      {descriptors.length > 1 && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Transmissão anterior"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setIndex((safeIndex - 1 + descriptors.length) % descriptors.length)}
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-bg-tertiary/75 text-text-primary hover:bg-primary"
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Próxima transmissão"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setIndex((safeIndex + 1) % descriptors.length)}
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-bg-tertiary/75 text-text-primary hover:bg-primary"
          >
            <ChevronRight size={14} />
          </Button>
        </>
      )}
    </div>,
    document.body
  );
}
