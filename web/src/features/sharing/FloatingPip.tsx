import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { Tile } from './Tile';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

interface DragPos {
  x: number;
  y: number;
}

/** Floating, draggable PiP with the current stream — shows whenever
 * `inCall` is true and the active view isn't "call" (e.g. Chat, see
 * App.tsx), since the call view's own grid already shows everything.
 * Positioned relative to the same wrapper CallControlBar uses (not the
 * whole viewport), so it never ends up under the LeftSidebar. */
export function FloatingPip({ allIds }: { allIds: string[] }) {
  const { state } = useRoom();
  const descriptors = useCallTiles(allIds).filter((d) => d.kind !== 'avatar');
  const [index, setIndex] = useState(0);
  const [dragPos, setDragPos] = useState<DragPos | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

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
      const nextLeft = Math.min(Math.max(0, left + (e.clientX - x)), Math.max(0, parentRect.width - box.offsetWidth));
      const nextTop = Math.min(Math.max(0, top + (e.clientY - y)), Math.max(0, parentRect.height - box.offsetHeight));
      setDragPos({ x: nextLeft, y: nextTop });
    }
    function stop() { setIsDragging(false); }
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
  }, [isDragging]);

  if (!current) return null;

  return (
    <div
      ref={boxRef}
      className={cn(
        'absolute z-30 aspect-video w-64 overflow-hidden rounded-xl shadow-popover ring-1 ring-foreground/10',
        !dragPos && 'bottom-4 right-4'
      )}
      style={dragPos ? { left: dragPos.x, top: dragPos.y } : undefined}
    >
      {/* Tile is display-only here — otherwise clicking it would change
          state.focusedId globally (leaking into the call view when
          switching back), and right-click would open TileMenu underneath
          the generic menu. */}
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
            aria-label="Transmissao anterior"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setIndex((safeIndex - 1 + descriptors.length) % descriptors.length)}
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-bg-tertiary/75 text-text-primary hover:bg-blurple"
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Proxima transmissao"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setIndex((safeIndex + 1) % descriptors.length)}
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-bg-tertiary/75 text-text-primary hover:bg-blurple"
          >
            <ChevronRight size={14} />
          </Button>
        </>
      )}
    </div>
  );
}
