import { WifiOff } from 'lucide-react';
import { useRoom } from '../state/RoomContext';

// Same floating-pill treatment and corner as FloatingPip's audio-only call
// badge (bottom-left) — FloatingPip shifts itself up (see its own
// `state.reconnecting` check) to make room here instead of overlapping.
export function ReconnectBanner() {
  const { state } = useRoom();
  if (!state.reconnecting) return null;
  return (
    <div className="fixed bottom-4 left-4 z-60 flex max-w-[calc(100%-2rem)] select-none items-center gap-2 rounded-full border border-strong bg-bg-floating/90 py-2.5 pl-3 pr-4 text-label font-medium text-text-primary shadow-popover backdrop-blur-xl">
      <span className="relative flex size-2.5 flex-none">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-red" />
      </span>
      <WifiOff size={15} className="flex-none" />
      <span className="min-w-0 truncate">Conexao com o servidor caiu. Reconectando...</span>
    </div>
  );
}
