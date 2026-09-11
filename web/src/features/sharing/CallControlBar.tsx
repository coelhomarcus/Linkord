import { useState } from 'react';
import { Headphones, HeadphoneOff, MessageCircle, Mic, MicOff, Monitor, MonitorX, PhoneOff, Smile, Video, VideoOff, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import type { ReactionEmoji } from '../../types/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

// Floating call reactions (burst animation on everyone's screen) stay a
// short fixed set — server (realtime/reactions.ts) enforces the same list.
// Unrelated to per-message chat reactions, which now accept any emoji.
const CALL_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;

interface CallControlBarProps {
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function CallControlBar({ chatOpen, onToggleChat }: CallControlBarProps) {
  const { state, dispatch, startCamera, stopCamera, startSharing, stopSharing, toggleMicMuted, deafened, toggleDeafened, leaveGroupCall, sendReaction } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const [reactionsOpen, setReactionsOpen] = useState(false);

  function pickReaction(emoji: ReactionEmoji) {
    sendReaction(emoji);
    setReactionsOpen(false);
  }

  const callButtonClass = 'h-11 w-11 rounded-full border border-strong bg-bg-floating/90 text-text-secondary shadow-popover backdrop-blur-xl hover:text-text-primary';

  return (
    <div className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {state.shareError && (
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <span className="min-w-0 flex-1">{state.shareError}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_SHARE_ERROR', message: null })}
            aria-label="Dispensar aviso"
            className="flex-none text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
          <PopoverTrigger
            aria-label="Reagir"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'h-11 w-11 rounded-full border border-strong bg-bg-floating/90 shadow-popover backdrop-blur-xl',
              reactionsOpen ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            <Smile size={18} />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" side="top">
            <div className="flex gap-1">
              {CALL_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => pickReaction(emoji)}
                  className="rounded-md p-1.5 text-[20px] leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger
            onClick={() => { void toggleMicMuted(); }}
            aria-label={myMedia.micMuted ? 'Desmutar' : 'Mutar'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), callButtonClass)}
          >
            {myMedia.micMuted ? <MicOff size={18} className="text-red" /> : <Mic size={18} />}
          </TooltipTrigger>
          <TooltipContent>{myMedia.micMuted ? 'Desmutar' : 'Mutar'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={toggleDeafened}
            aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), callButtonClass)}
          >
            {deafened ? <HeadphoneOff size={18} className="text-red" /> : <Headphones size={18} />}
          </TooltipTrigger>
          <TooltipContent>{deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={() => { void (cameraOn ? stopCamera() : startCamera()); }}
            aria-label={cameraOn ? 'Parar camera' : 'Ligar camera'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), callButtonClass)}
          >
            {cameraOn ? <Video size={18} className="text-green" /> : <VideoOff size={18} />}
          </TooltipTrigger>
          <TooltipContent>{cameraOn ? 'Parar camera' : 'Ligar camera'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={() => { void (sharing ? stopSharing() : startSharing()); }}
            aria-label={sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), callButtonClass)}
          >
            {sharing ? <MonitorX size={18} className="text-primary" /> : <Monitor size={18} />}
          </TooltipTrigger>
          <TooltipContent>{sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={onToggleChat}
            aria-label={chatOpen ? 'Fechar chat' : 'Abrir chat'}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'h-11 w-11 rounded-full border border-strong bg-bg-floating/90 shadow-popover backdrop-blur-xl',
              chatOpen ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            <MessageCircle size={18} />
          </TooltipTrigger>
          <TooltipContent>{chatOpen ? 'Fechar chat' : 'Abrir chat'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={leaveGroupCall}
            aria-label="Sair da chamada"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), 'h-11 w-11 rounded-full bg-red text-white shadow-popover hover:bg-red-hover')}
          >
            <PhoneOff size={18} />
          </TooltipTrigger>
          <TooltipContent>Sair da chamada</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
