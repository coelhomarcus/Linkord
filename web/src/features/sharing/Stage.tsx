import { ArrowLeft } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { TileGrid } from './TileGrid';
import { Button } from '@/components/ui/button';

interface StageProps {
  allIds: string[];
  /** Below md, a floating back button returns to the channel list — Stage
   * itself has no header to put one in (full-bleed video grid). Irrelevant
   * from md up, where the sidebar is always visible. */
  onBackMobile: () => void;
}

/** A pair of tiles per participant, sharing or not — like Discord/Google
 * Meet's expanded view. A participant's screen and camera become separate
 * rectangles (see useCallTiles); anyone with neither just shows avatar+name
 * (kind 'avatar', see Tile.tsx). The self-adjusting grid (TileGrid) already
 * handles any number of tiles. <CallControlBar/> and
 * <ParticipantAudioLayer/> used to live here — moved up to the Shell
 * (App.tsx) along with `allIds` so controls and everyone else's audio keep
 * working while another channel's tab is active (see App.tsx). */
export function Stage({ allIds, onBackMobile }: StageProps) {
  const { state } = useRoom();
  const descriptors = useCallTiles(allIds);

  return (
    <main className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto bg-bg-call p-2 pb-24 text-text-primary md:p-5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Voltar pros canais"
        onClick={onBackMobile}
        className="absolute left-2 top-2 z-20 bg-bg-tertiary/80 text-text-secondary hover:bg-bg-hover md:hidden"
      >
        <ArrowLeft size={18} />
      </Button>
      <TileGrid descriptors={descriptors} focusedId={state.focusedId} />
    </main>
  );
}
