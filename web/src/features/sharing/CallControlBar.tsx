import { useState } from 'react';
import type { ReactNode } from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, MonitorX, PhoneOff, Smile, Video, VideoOff, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import { ALLOWED_REACTIONS } from '../../types/protocol';
import type { ReactionEmoji } from '../../types/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

/** The button background stays neutral — the ICON color carries the state's
 * meaning (mic muted = red, camera on = green, etc.). Subtler than painting
 * the whole button, and lets several controls' state be read at a glance
 * without each becoming a big colored blob. */
function ControlButton({ onClick, label, icon, iconColorClass }: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  iconColorClass: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
          'h-11 w-11 rounded-full bg-bg-tertiary hover:bg-bg-selected',
          iconColorClass
        )}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Discord-style floating bar with mic/camera/screen controls — only mounts
 * when `inCall` is true (App.tsx), so the mic here never needs a "not yet
 * activated" state: that already happened before this existed (see the
 * click on a voice channel in the sidebar). */
export function CallControlBar() {
  const { state, dispatch, startCamera, stopCamera, startSharing, stopSharing, toggleMicMuted, deafened, toggleDeafened, leaveVoiceChannel, sendReaction } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const [reactionsOpen, setReactionsOpen] = useState(false);

  function pickReaction(emoji: ReactionEmoji) {
    sendReaction(emoji);
    setReactionsOpen(false);
  }

  return (
    // column: the sharing warning (when present) STACKS on top of the
    // control pill, both centered together — needs only ONE anchor point
    // (bottom-6/centered) instead of two absolute blocks computing the
    // distance between them.
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {state.shareError && (
        <div className="flex max-w-100 items-start gap-2 rounded-md border border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover">
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
      <div className="flex items-center gap-1 rounded-full border border-strong bg-bg-floating/90 px-4 py-2.5 shadow-popover backdrop-blur">
        <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
          <PopoverTrigger
            aria-label="Reagir"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'h-11 w-11 rounded-full',
              reactionsOpen ? 'bg-bg-selected text-text-primary' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-selected hover:text-text-primary'
            )}
          >
            <Smile size={18} />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" side="top">
            <div className="flex gap-1">
              {ALLOWED_REACTIONS.map((emoji) => (
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

        <ControlButton
          onClick={toggleMicMuted}
          label={myMedia.micMuted ? 'Desmutar' : 'Mutar'}
          icon={myMedia.micMuted ? <MicOff size={18} /> : <Mic size={18} />}
          // muted: red (warning — no one hears you). unmuted: normal gray,
          // the expected state while talking.
          iconColorClass={myMedia.micMuted ? 'text-red' : 'text-text-secondary'}
        />
        <ControlButton
          onClick={toggleDeafened}
          label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
          icon={deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          iconColorClass={deafened ? 'text-red' : 'text-text-secondary'}
        />
        <ControlButton
          onClick={() => (cameraOn ? stopCamera() : startCamera())}
          label={cameraOn ? 'Parar camera' : 'Ligar camera'}
          icon={cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
          iconColorClass={cameraOn ? 'text-green' : 'text-text-secondary'}
        />
        <ControlButton
          onClick={() => (sharing ? stopSharing() : startSharing())}
          label={sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
          icon={sharing ? <MonitorX size={18} /> : <Monitor size={18} />}
          iconColorClass={sharing ? 'text-blurple' : 'text-text-secondary'}
        />

        <Tooltip>
          <TooltipTrigger
            onClick={leaveVoiceChannel}
            aria-label="Sair da chamada"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), 'h-11 w-11 rounded-full bg-red text-white hover:bg-red-hover')}
          >
            <PhoneOff size={18} />
          </TooltipTrigger>
          <TooltipContent>Sair da chamada</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
