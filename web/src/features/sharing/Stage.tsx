import { ArrowLeft } from 'lucide-react';
import { useAnimatedSidebar } from '@/components/motion/animated-sidebar';
import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { TileGrid } from './TileGrid';
import { Button } from '@/components/ui/button';

interface StageProps {
  allIds: string[];
}

export function Stage({ allIds }: StageProps) {
  const { state, hideAudioOnlyTiles } = useRoom();
  const { setOpenMobile } = useAnimatedSidebar();
  const allDescriptors = useCallTiles(allIds);
  const descriptors = hideAudioOnlyTiles ? allDescriptors.filter((d) => d.kind !== 'avatar') : allDescriptors;

  return (
    <main data-stage className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto bg-bg-call p-2 pb-32 text-text-primary md:px-5 md:pt-5">
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
      <TileGrid descriptors={descriptors} focusedId={state.focusedId} />
    </main>
  );
}
