import { forwardRef, useState } from 'react';
import { Headphones, HeadphoneOff, Maximize2, Mic, MicOff, Minimize2, Monitor, MonitorX, PhoneOff, Smile, Video, VideoOff } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useRoom } from '../../state/RoomContext';
import type { MicProblem } from '@/state/roomReducer';
import { useParticipantMedia } from './useLiveKitTrack';
import type { ReactionEmoji } from '@/shared/types/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { CameraQuickMenu, MicQuickMenu, ScreenShareQuickMenu, SpeakerQuickMenu } from './CallDeviceMenus';
import { cn } from '@/shared/lib/utils';

// Floating call reactions (burst animation on everyone's screen) stay a
// short fixed set — server (realtime/reactions.ts) enforces the same list.
// Unrelated to per-message chat reactions, which now accept any emoji.
const CALL_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;

const MIC_PROBLEM_LABEL = {
  'not-found': 'Nenhum microfone encontrado',
  denied: 'Microfone bloqueado pelo navegador',
  unavailable: 'Microfone indisponível',
} as const;

const MIC_PROBLEM_NOTICE = {
  'not-found': 'Nenhum microfone encontrado. Você está na chamada, mas ninguém te ouve — conecte um microfone e ele será ativado sozinho.',
  denied: 'O navegador bloqueou o microfone. Você está na chamada, mas ninguém te ouve — libere o microfone nas permissões do site e clique no botão do microfone.',
  unavailable: 'Não foi possível iniciar o microfone — ele pode estar em uso por outro aplicativo. Você está na chamada, mas ninguém te ouve; clique no botão do microfone para tentar de novo.',
} as const;

// The bar is intentionally theme-independent (black material, white-based
// states) — it stays the same over the dark call stage regardless of the
// app's own light/dark theme, matching the Fluxer reference. Sizes shrink
// at 480/360px (viewport width, not the stage's own measured width — the
// stage doesn't expose that yet; see the calls redesign plan's E5/E10).
const BAR_BUTTON = 'grid size-11 flex-none place-items-center rounded-2xl transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/50 active:translate-y-px max-[480px]:size-10 max-[480px]:rounded-[14px] max-[360px]:size-9 max-[360px]:rounded-[13px]';
const BAR_BUTTON_NEUTRAL = 'bg-white/5 text-white/90 hover:bg-white/12';
const BAR_BUTTON_RED = 'bg-red/16 text-red hover:bg-red/24';
const BAR_BUTTON_GREEN = 'bg-green/16 text-green hover:bg-green/24';
const BAR_ICON = 'size-[22px] max-[480px]:size-5 max-[360px]:size-[19px]';

interface CallControlBarProps {
  /** Fades out (but stays mounted, never affecting layout) when the HUD
   * auto-hides after inactivity — see useCallHud.ts. */
  hudVisible?: boolean;
}

// forwardRef so Stage.tsx can measure this wrapper's real rendered height
// (banners + bar + gaps) and reserve exactly that much space for it instead
// of a fixed `pb-32` guess (see the calls redesign plan §5.1).
export const CallControlBar = forwardRef<HTMLDivElement, CallControlBarProps>(function CallControlBar({ hudVisible = true }, ref) {
  const {
    state, dispatch, startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted, deafened, toggleDeafened,
    leaveCall, sendReaction, reconnecting, isCallFullscreen, toggleCallFullscreen, fullscreenElement,
  } = useRoom();
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

  return (
    <div
      ref={ref}
      className={cn(
        'absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-200 motion-reduce:transition-none',
        hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
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
      <div className="flex items-center gap-1 rounded-3xl border border-white/10 bg-black p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)] max-[480px]:gap-0.75 max-[480px]:p-1.25 max-[360px]:gap-0.5 max-[360px]:p-1">
        <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
          <PopoverTrigger
            aria-label="Reagir"
            className={cn(BAR_BUTTON, reactionsOpen ? 'bg-white/12 text-white' : BAR_BUTTON_NEUTRAL)}
          >
            <Smile className={BAR_ICON} />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" side="top" container={fullscreenElement ?? undefined}>
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

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { void (myMedia.micActivated ? toggleMicMuted() : activateMic()); }}
              aria-label={micLabel}
              className={cn(BAR_BUTTON, 'relative', myMedia.micMuted || micProblem ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {myMedia.micMuted ? <MicOff className={BAR_ICON} /> : <Mic className={BAR_ICON} />}
              {micProblem && <span aria-hidden className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-black bg-red" />}
            </TooltipTrigger>
            <TooltipContent>{micLabel}</TooltipContent>
          </Tooltip>
          <MicQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={toggleDeafened}
              aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
              className={cn(BAR_BUTTON, deafened ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {deafened ? <HeadphoneOff className={BAR_ICON} /> : <Headphones className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}</TooltipContent>
          </Tooltip>
          <SpeakerQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { void (cameraOn ? stopCamera() : startCamera()); }}
              aria-label={cameraOn ? 'Parar câmera' : 'Ligar câmera'}
              className={cn(BAR_BUTTON, cameraOn ? BAR_BUTTON_GREEN : BAR_BUTTON_NEUTRAL)}
            >
              {cameraOn ? <Video className={BAR_ICON} /> : <VideoOff className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{cameraOn ? 'Parar câmera' : 'Ligar câmera'}</TooltipContent>
          </Tooltip>
          <CameraQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { void (sharing ? stopSharing() : startSharing()); }}
              aria-label={sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
              className={cn(BAR_BUTTON, sharing ? BAR_BUTTON_GREEN : BAR_BUTTON_NEUTRAL)}
            >
              {sharing ? <MonitorX className={BAR_ICON} /> : <Monitor className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}</TooltipContent>
          </Tooltip>
          <ScreenShareQuickMenu />
        </div>

        <Tooltip>
          <TooltipTrigger
            onClick={() => void toggleCallFullscreen()}
            aria-label={isCallFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            className={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)}
          >
            {isCallFullscreen ? <Minimize2 className={BAR_ICON} /> : <Maximize2 className={BAR_ICON} />}
          </TooltipTrigger>
          <TooltipContent>{isCallFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</TooltipContent>
        </Tooltip>

        <div aria-hidden className="mx-0.5 h-6 w-px flex-none bg-white/10" />

        <Tooltip>
          <TooltipTrigger
            onClick={leaveCall}
            aria-label="Sair da chamada"
            className={cn(BAR_BUTTON, 'bg-red text-white hover:bg-red-hover')}
          >
            <PhoneOff className={BAR_ICON} />
          </TooltipTrigger>
          <TooltipContent>Sair da chamada</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
