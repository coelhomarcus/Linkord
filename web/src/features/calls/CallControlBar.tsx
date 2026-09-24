import { useState } from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, MonitorX, PhoneOff, Smile, Video, VideoOff } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useRoom } from '../../state/RoomContext';
import type { MicProblem } from '@/state/roomReducer';
import { useParticipantMedia } from './useLiveKitTrack';
import type { ReactionEmoji } from '@/shared/types/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

// Floating call reactions (burst animation on everyone's screen) stay a
// short fixed set — server (realtime/reactions.ts) enforces the same list.
// Unrelated to per-message chat reactions, which now accept any emoji.
const CALL_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;

const MIC_PROBLEM_LABEL = {
  'not-found': 'Nenhum microfone encontrado',
  denied: 'Microfone bloqueado pelo navegador',
} as const;

const MIC_PROBLEM_NOTICE = {
  'not-found': 'Nenhum microfone encontrado. Você está na chamada, mas ninguém te ouve — conecte um microfone e ele será ativado sozinho.',
  denied: 'O navegador bloqueou o microfone. Você está na chamada, mas ninguém te ouve — libere o microfone nas permissões do site e clique no botão do microfone.',
} as const;

export function CallControlBar() {
  const { state, dispatch, startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted, deafened, toggleDeafened, leaveCall, sendReaction, reconnecting } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const micProblem = myMedia.micActivated ? null : state.micProblem;
  // Dismissing hides this occurrence only: once the problem clears, the next
  // one (a later call, the mic unplugged again) has to show again.
  const [dismissedMicProblem, setDismissedMicProblem] = useState<MicProblem>(null);
  if (!micProblem && dismissedMicProblem) setDismissedMicProblem(null);
  const micLabel = micProblem ? MIC_PROBLEM_LABEL[micProblem] : !myMedia.micActivated ? 'Ativar microfone' : myMedia.micMuted ? 'Desmutar' : 'Mutar';

  function pickReaction(emoji: ReactionEmoji) {
    sendReaction(emoji);
    setReactionsOpen(false);
  }

  const callButtonClass = 'h-11 w-11 rounded-full border border-strong bg-bg-floating/90 text-text-secondary shadow-popover backdrop-blur-xl hover:text-text-primary';

  return (
    <div className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {reconnecting && (
        <div className="rounded-md border border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover">
          Reconectando à chamada…
        </div>
      )}
      {state.shareError && (
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <span className="min-w-0 flex-1">{state.shareError}</span>
          <CloseButton size="xs" label="Dispensar aviso" onClick={() => dispatch({ type: 'SET_SHARE_ERROR', message: null })} />
        </div>
      )}
      {micProblem && micProblem !== dismissedMicProblem && (
        <div role="status" className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-red/40 bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <MicOff size={16} className="mt-0.5 flex-none text-red" />
          <span className="min-w-0 flex-1">{MIC_PROBLEM_NOTICE[micProblem]}</span>
          <CloseButton size="xs" label="Dispensar aviso" onClick={() => setDismissedMicProblem(micProblem)} />
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
            onClick={() => { void (myMedia.micActivated ? toggleMicMuted() : activateMic()); }}
            aria-label={micLabel}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), callButtonClass, 'relative')}
          >
            {myMedia.micMuted ? <MicOff size={18} className="text-red" /> : <Mic size={18} />}
            {micProblem && <span aria-hidden className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-floating bg-red" />}
          </TooltipTrigger>
          <TooltipContent>{micLabel}</TooltipContent>
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
            aria-label={cameraOn ? 'Parar câmera' : 'Ligar câmera'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), callButtonClass)}
          >
            {cameraOn ? <Video size={18} className="text-green" /> : <VideoOff size={18} />}
          </TooltipTrigger>
          <TooltipContent>{cameraOn ? 'Parar câmera' : 'Ligar câmera'}</TooltipContent>
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
            onClick={leaveCall}
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
