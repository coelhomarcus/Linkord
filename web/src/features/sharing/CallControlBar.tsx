import { useState } from 'react';
import type { ReactNode } from 'react';
import { Headphones, HeadphoneOff, LoaderCircle, Mic, MicOff, Monitor, MonitorX, PhoneOff, Smile, Video, VideoOff, X } from 'lucide-react';
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
function ControlButton({ onClick, label, icon, iconColorClass, disabled = false, busy = false }: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  iconColorClass: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-busy={busy || undefined}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
          'h-9 w-9 rounded-full bg-bg-tertiary hover:bg-bg-selected md:h-11 md:w-11',
          iconColorClass
        )}
      >
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface CallControlBarProps {
  onLeave: () => void;
}

/** Discord-style floating bar with mic/camera/screen controls. A connected
 * participant may intentionally have no mic publication (listen-only), so
 * the microphone control can also request permission and activate it. */
export function CallControlBar({ onLeave }: CallControlBarProps) {
  const {
    state, dispatch, startCamera, stopCamera, startSharing, stopSharing,
    enableMicrophone, toggleMicMuted, deafened, toggleDeafened,
    leaveVoiceChannel, sendReaction, voiceConnection,
  } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'microphone' | 'camera' | 'screen' | null>(null);

  function pickReaction(emoji: ReactionEmoji) {
    sendReaction(emoji);
    setReactionsOpen(false);
  }

  async function runMediaAction(action: 'microphone' | 'camera' | 'screen', task: () => Promise<void>) {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      await task();
    } finally {
      setPendingAction(null);
    }
  }

  function handleMicrophone() {
    void runMediaAction('microphone', myMedia.micActivated ? toggleMicMuted : enableMicrophone);
  }

  function handleCamera() {
    void runMediaAction('camera', async () => {
      if (cameraOn) stopCamera();
      else await startCamera();
    });
  }

  function handleScreenShare() {
    void runMediaAction('screen', async () => {
      if (sharing) stopSharing();
      else await startSharing();
    });
  }

  async function handleLeave() {
    await leaveVoiceChannel();
    onLeave();
  }

  const microphoneLabel = pendingAction === 'microphone'
    ? 'Ativando microfone'
    : !myMedia.micActivated
      ? 'Ativar microfone'
      : myMedia.micMuted ? 'Desmutar' : 'Mutar';

  return (
    // column: the sharing warning (when present) STACKS on top of the
    // control pill, both centered together — needs only ONE anchor point
    // (bottom-6/centered) instead of two absolute blocks computing the
    // distance between them.
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {voiceConnection.mode === 'listen-only' && (
        <div
          role="status"
          aria-live="polite"
          className="flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-md border border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100"
        >
          <Headphones className="size-4 flex-none text-blurple" aria-hidden="true" />
          <span>Modo somente ouvir. Ative o microfone quando quiser falar.</span>
        </div>
      )}
      {state.shareError && (
        <div
          role="alert"
          className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100"
        >
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
      <div className="flex max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-full border border-strong bg-bg-floating/90 px-2 py-2 shadow-popover backdrop-blur md:gap-1 md:px-4 md:py-2.5">
        <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
          <PopoverTrigger
            aria-label="Reagir"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'h-9 w-9 rounded-full md:h-11 md:w-11',
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
          onClick={handleMicrophone}
          label={microphoneLabel}
          icon={!myMedia.micActivated || myMedia.micMuted ? <MicOff size={18} /> : <Mic size={18} />}
          // muted: red (warning — no one hears you). unmuted: normal gray,
          // the expected state while talking.
          iconColorClass={!myMedia.micActivated || myMedia.micMuted ? 'text-red' : 'text-text-secondary'}
          disabled={pendingAction !== null}
          busy={pendingAction === 'microphone'}
        />
        <ControlButton
          onClick={toggleDeafened}
          label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
          icon={deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          iconColorClass={deafened ? 'text-red' : 'text-text-secondary'}
        />
        <ControlButton
          onClick={handleCamera}
          label={pendingAction === 'camera' ? 'Ativando camera' : cameraOn ? 'Parar camera' : 'Ligar camera'}
          icon={cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
          iconColorClass={cameraOn ? 'text-green' : 'text-text-secondary'}
          disabled={pendingAction !== null}
          busy={pendingAction === 'camera'}
        />
        <ControlButton
          onClick={handleScreenShare}
          label={pendingAction === 'screen' ? 'Iniciando compartilhamento' : sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
          icon={sharing ? <MonitorX size={18} /> : <Monitor size={18} />}
          iconColorClass={sharing ? 'text-blurple' : 'text-text-secondary'}
          disabled={pendingAction !== null}
          busy={pendingAction === 'screen'}
        />

        <Tooltip>
          <TooltipTrigger
            onClick={() => void handleLeave()}
            aria-label="Sair da chamada"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), 'h-9 w-9 rounded-full bg-red text-white hover:bg-red-hover md:h-11 md:w-11')}
          >
            <PhoneOff size={18} />
          </TooltipTrigger>
          <TooltipContent>Sair da chamada</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
