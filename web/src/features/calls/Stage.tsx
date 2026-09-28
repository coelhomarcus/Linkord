import { useCallback } from 'react';
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

  return (
    <main ref={callStageRef} data-stage className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto bg-bg-call p-2 pb-32 text-text-primary md:px-5 md:pt-5">
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
        <TileGrid descriptors={descriptors} focusedId={state.focusedId} />
      )}
      <CallControlBar hudVisible={hudVisible} />
      <CallChatToggleButton chatOpen={chatOpen} onToggleChat={onToggleChat} hudVisible={hudVisible} />
    </main>
  );
}
