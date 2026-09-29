import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, VideoOff } from 'lucide-react';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { useAutoFocusScreenShare } from './useAutoFocusScreenShare';
import { useCallHud } from './useCallHud';
import { TileGrid } from './TileGrid';
import { CallControlBar } from './CallControlBar';
import { CallChatToggleButton } from './CallChatToggleButton';
import { Button } from '@/shared/ui/primitives/button';

interface StageProps {
  allIds: string[];
  chatOpen: boolean;
  onToggleChat: () => void;
}

// Matches the old fixed `pb-32` (8rem) until the control bar's real height
// is measured — same reasoning as useCallFullscreen's graceful fallback:
// never a visible jump, just a brief window before the first real value.
const FALLBACK_RESERVED_BOTTOM = 128;
// The gap between the tile grid and the bar itself — same 1.5rem the bar
// already uses for its own distance from the true bottom edge.
const BAR_GRID_GAP = 24;

export function Stage({ allIds, chatOpen, onToggleChat }: StageProps) {
  const { state, dispatch, hideAudioOnlyTiles, setHideAudioOnlyTiles, callStageRef, reconnecting, menuTarget } = useRoom();
  const { setOpenMobile } = useAnimatedSidebar();
  const allDescriptors = useCallTiles(allIds);
  const descriptors = hideAudioOnlyTiles ? allDescriptors.filter((d) => d.kind !== 'avatar') : allDescriptors;
  const focusScreenShare = useCallback((key: string) => dispatch({ type: 'SET_FOCUSED', id: key, origin: 'automatic' }), [dispatch]);
  useAutoFocusScreenShare(allDescriptors, state.focusOrigin, focusScreenShare);
  // "Ocultar sem vídeo" filtering everyone out reads as a black-screen bug
  // otherwise — nothing on stage explains why, since the option lives in a
  // right-click menu, not a visible toggle.
  const allHiddenByFilter = allDescriptors.length > 0 && descriptors.length === 0;

  // A tile menu open, reconnecting, or an actionable error keeps the HUD
  // forced visible regardless of the idle timer (plan §11.3).
  const suspendHud = !!menuTarget || reconnecting || !!state.shareError || !!state.micProblem || !!state.callJoinError;
  const { hudVisible } = useCallHud(suspendHud);

  // Reserves exactly as much bottom space as the bar (+ any banners above
  // it) actually needs, instead of a fixed `pb-32` guess that's either too
  // little for a taller bar (a mic-problem banner appearing) or wastes grid
  // space when there's nothing to reserve room for (plan §5.1).
  const controlBarRef = useRef<HTMLDivElement | null>(null);
  const [reservedBottom, setReservedBottom] = useState(FALLBACK_RESERVED_BOTTOM);
  useLayoutEffect(() => {
    const el = controlBarRef.current;
    if (!el) return;
    const measure = () => setReservedBottom(el.getBoundingClientRect().height + BAR_GRID_GAP);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // "Se nem todos couberem, transicionar para foco" (plan §5.2 point 8) —
  // TileGrid only reports the geometry; this is the one place that decides
  // what it means. Never overrides a manual (or screen-share-driven
  // automatic) focus, and only retracts a focus IT caused once space
  // recovers — never one it didn't.
  const handleCapacityChange = useCallback((meetsMinimum: boolean, suggestedKey: string | null) => {
    if (state.focusOrigin === 'manual') return;
    if (!meetsMinimum && !state.focusedId && suggestedKey) {
      dispatch({ type: 'SET_FOCUSED', id: suggestedKey, origin: 'capacity' });
    } else if (meetsMinimum && state.focusOrigin === 'capacity') {
      dispatch({ type: 'SET_FOCUSED', id: null, origin: 'capacity' });
    }
  }, [state.focusOrigin, state.focusedId, dispatch]);

  return (
    <main
      ref={callStageRef}
      data-stage
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto bg-bg-call p-2 text-text-primary md:px-5 md:pt-5"
      style={{ paddingBottom: reservedBottom }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Voltar para conversas"
        onClick={() => setOpenMobile(true)}
        className="absolute left-2 top-2 z-20 bg-bg-tertiary/80 text-text-secondary hover:bg-bg-hover md:hidden"
      >
        <ArrowLeft size={18} />
      </Button>
      {allHiddenByFilter ? (
        <div className="flex flex-col items-center gap-3 px-6 text-center text-text-muted">
          <VideoOff size={28} />
          <p className="text-body">
            Ninguém está com a câmera ligada agora.<br />
            A opção <span className="font-medium text-text-secondary">"Ocultar sem vídeo"</span> está ativada.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setHideAudioOnlyTiles(false)}>
            Mostrar todos
          </Button>
        </div>
      ) : (
        <TileGrid descriptors={descriptors} focusedId={state.focusedId} onCapacityChange={handleCapacityChange} />
      )}
      <CallControlBar ref={controlBarRef} hudVisible={hudVisible} />
      <CallChatToggleButton chatOpen={chatOpen} onToggleChat={onToggleChat} hudVisible={hudVisible} />
    </main>
  );
}
