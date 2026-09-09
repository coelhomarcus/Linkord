import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Download, Maximize2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/shared/lib/utils';
import { downloadFile } from '@/shared/lib/download';

function sliderValue(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : (value[0] ?? 0);
}

function readableDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

interface MediaControlsState {
  currentTime: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  volume: number;
}

function useMediaControls<T extends HTMLMediaElement>() {
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<MediaControlsState>({
    currentTime: 0,
    duration: 0,
    playing: false,
    muted: false,
    volume: 1,
  });
  const [waiting, setWaiting] = useState(false);

  function sync() {
    const media = ref.current;
    if (!media) return;
    setState({
      currentTime: media.currentTime || 0,
      duration: readableDuration(media.duration),
      playing: !media.paused,
      muted: media.muted,
      volume: media.volume,
    });
  }

  async function togglePlay() {
    const media = ref.current;
    if (!media) return;
    if (media.paused) {
      await media.play().catch(() => {});
    } else {
      media.pause();
    }
    sync();
  }

  function seek(value: number | readonly number[]) {
    const media = ref.current;
    if (!media) return;
    const next = Math.min(state.duration || 0, Math.max(0, sliderValue(value)));
    media.currentTime = next;
    setState((prev) => ({ ...prev, currentTime: next }));
  }

  function setVolume(value: number | readonly number[]) {
    const media = ref.current;
    if (!media) return;
    const next = Math.min(100, Math.max(0, sliderValue(value))) / 100;
    media.volume = next;
    media.muted = next === 0 ? true : false;
    sync();
  }

  function toggleMute() {
    const media = ref.current;
    if (!media) return;
    if (media.muted && media.volume === 0) media.volume = 0.7;
    media.muted = !media.muted;
    sync();
  }

  return {
    ref,
    state,
    waiting,
    sync,
    setWaiting,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
  };
}

/* Botao de controle: mesma altura (28px) e mesmo icone (15px) nos dois players,
   pra fila de icones ficar alinhada em qualquer largura. */
function MediaButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={onClick}
      className={cn('size-7 flex-none [&_svg:not([class*=size-])]:size-[15px]', className)}
    >
      {children}
    </Button>
  );
}

/* O slider do Base UI marca a orientacao no proprio root, e a classe de
   orientacao (data-[orientation=horizontal]:w-full) tem especificidade maior
   que um w-* solto — entao largura fixa so segura dentro de um wrapper. */
function VolumeSlider({ muted, volume, onChange, className }: {
  muted: boolean;
  volume: number;
  onChange: (value: number | readonly number[]) => void;
  className?: string;
}) {
  return (
    <div className={cn('w-14 flex-none', className)}>
      <Slider
        aria-label="Volume"
        value={[muted ? 0 : Math.round(volume * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={onChange}
        className="[&_[data-slot=slider-thumb]]:size-2.5"
      />
    </div>
  );
}

interface VideoPlayerProps {
  src: string;
  poster?: string | null;
  title?: string;
  className?: string;
  onError?: () => void;
}

export function VideoPlayer({ src, poster, title, className, onError }: VideoPlayerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <VideoPlayerInner key={src} src={src} poster={poster} title={title} className={className} onError={onError} onExpand={() => setLightboxOpen(true)} />
      <VideoLightbox src={src} poster={poster} title={title} open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}

function VideoLightbox({ src, poster, title, open, onOpenChange }: VideoPlayerProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-4 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 sm:p-8"
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">{title || 'Video'}</DialogPrimitive.Title>
          {/* no w-full: this is a flex child of the centered Popup below —
              stretching it to full width left everything to the left of it
              (a plain block child inside a wide div sits at the left edge by
              default). Left as a shrink-to-fit flex item, it hugs the
              video's own computed size (see boxStyle in VideoPlayerInner),
              so the parent's justify-center actually centers the video
              itself instead of an invisible full-width box around it. */}
          <div
            className="max-w-6xl cursor-default"
            data-download-url={src}
            data-download-name={title || 'video'}
            onClick={(event) => event.stopPropagation()}
          >
            <VideoPlayerInner src={src} poster={poster} title={title} className="border-white/20 shadow-popover" />
          </div>
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="fixed right-4 top-4 z-50 flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X size={18} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function VideoPlayerInner({ src, poster, title, className, onError, onExpand }: VideoPlayerProps & { onExpand?: () => void }) {
  const {
    ref,
    state: { currentTime, duration, playing, muted, volume },
    waiting,
    sync,
    setWaiting,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
  } = useMediaControls<HTMLVideoElement>();
  // the video's OWN intrinsic size, read once metadata loads — used to size
  // the wrapper below so its border/rounding hug the video's real shape
  // instead of a fixed 16:9 box that letterboxed anything else (portrait,
  // square, ultrawide...) with black bars.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  function expand() {
    ref.current?.pause();
    onExpand?.();
  }

  function handleLoadedMetadata() {
    sync();
    const video = ref.current;
    if (video) setNatural({ width: video.videoWidth, height: video.videoHeight });
  }

  // Computed in JS, not left to CSS "shrink to content" (w-fit): a
  // `@container` query context forces size containment on its own box,
  // which makes fit-content sizing collapse to 0 for a container nested
  // inside a flex-centered ancestor (Base UI's Dialog, i.e. the fullscreen
  // lightbox) — it only "worked" inline by coincidence of that simpler
  // layout context. Explicit pixel dimensions sidestep the conflict
  // entirely and behave identically in both places.
  // onExpand only exists on the small inline/chat player, never the
  // fullscreen lightbox (see VideoPlayer/VideoLightbox below) — that's
  // what picks which size cap applies.
  const maxWidth = onExpand ? 384 : Math.min(window.innerWidth - 64, 1152);
  const maxHeight = onExpand ? 320 : window.innerHeight * 0.8;
  // maxWidth above assumes the chat column has room for it — it doesn't
  // know the actual parent width. `maxWidth: '100%'` + `aspectRatio` (in
  // place of a fixed `height`) let the box shrink below that on narrow
  // columns/screens while the video keeps its real proportions, instead of
  // overflowing the message or getting squashed by a fixed height.
  const boxStyle: CSSProperties = natural && natural.width > 0 && natural.height > 0
    ? (() => {
        const scale = Math.min(1, maxWidth / natural.width, maxHeight / natural.height);
        return {
          width: natural.width * scale,
          maxWidth: '100%',
          aspectRatio: `${natural.width} / ${natural.height}`,
          maxHeight,
        };
      })()
    // before metadata loads: a reasonable 16:9 placeholder at max width, so
    // something visible shows up immediately instead of a 0-size flash.
    : { width: maxWidth, maxWidth: '100%', aspectRatio: '16 / 9', maxHeight };

  return (
    <div
      className={cn('group/player @container/player relative overflow-hidden rounded-md border border-strong bg-black shadow-panel', className)}
      style={boxStyle}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={src}
        poster={poster || undefined}
        preload="metadata"
        playsInline
        title={title}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={sync}
        onPlay={sync}
        onPause={sync}
        onVolumeChange={sync}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onError={onError}
        className="block h-full w-full"
      />

      {/* Clique na area do video alterna play/pause, como em qualquer player.
          E so um atalho de mouse: aria-hidden + tabIndex -1 pra nao duplicar o
          botao de reproduzir que ja existe nos controles. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={togglePlay}
        className="absolute inset-0 cursor-pointer outline-none"
      />

      {waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      {!playing && (
        <button
          type="button"
          aria-label="Reproduzir video"
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-popover transition-colors hover:bg-blurple focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Play size={22} fill="currentColor" className="ml-0.5" />
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2.5 pb-2 pt-8 transition-opacity md:pointer-events-none md:opacity-0 md:group-hover/player:pointer-events-auto md:group-hover/player:opacity-100 md:group-focus-within/player:pointer-events-auto md:group-focus-within/player:opacity-100">
        <Slider
          value={[duration ? currentTime : 0]}
          min={0}
          max={duration || 1}
          step={0.1}
          disabled={!duration}
          onValueChange={(value) => seek(value)}
          className="[&_[data-slot=slider-range]]:bg-blurple [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-track]]:bg-white/25"
        />
        {/* min-w-0 + itens flex-none: o botao de tela cheia nunca e empurrado
            pra fora do container (que e overflow-hidden). Abaixo de ~19rem de
            largura o slider de volume sai e sobra so o botao de mudo. */}
        <div className="flex min-w-0 items-center gap-0.5 text-text-secondary [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
          <MediaButton label={playing ? 'Pausar' : 'Reproduzir'} onClick={togglePlay}>
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </MediaButton>
          <span className="ml-1 hidden flex-none select-none text-caption tabular-nums text-text-muted @[15rem]/player:block">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="ml-auto flex flex-none items-center gap-0.5">
            <MediaButton label={muted || volume === 0 ? 'Desmutar' : 'Mutar'} onClick={toggleMute}>
              {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </MediaButton>
            <VolumeSlider
              muted={muted}
              volume={volume}
              onChange={setVolume}
              className="mr-1 hidden @[19rem]/player:block [&_[data-slot=slider-range]]:bg-white/80 [&_[data-slot=slider-track]]:bg-white/25"
            />
            <MediaButton label="Baixar" onClick={() => downloadFile(src, title || 'video')}>
              <Download size={15} />
            </MediaButton>
            {onExpand && (
              <MediaButton label="Tela cheia" onClick={expand}>
                <Maximize2 size={15} />
              </MediaButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AudioPlayerProps {
  src: string;
  title?: string;
  className?: string;
  onError?: () => void;
}

export function AudioPlayer({ src, title, className, onError }: AudioPlayerProps) {
  return <AudioPlayerInner key={src} src={src} title={title} className={className} onError={onError} />;
}

function AudioPlayerInner({ src, title, className, onError }: AudioPlayerProps) {
  const {
    ref,
    state: { currentTime, duration, playing, muted, volume },
    sync,
    setWaiting,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
  } = useMediaControls<HTMLAudioElement>();

  return (
    <div
      // duas linhas em vez de uma so (titulo+tempo em cima, play+slider+
      // controles embaixo): o play button e o grupo mutar/volume/baixar
      // deixavam de disputar largura com o slider na mesma linha, entao o
      // player inteiro cabe num max-w bem menor sem espremer nada.
      className={cn('@container/audio flex w-full min-w-0 max-w-sm flex-col gap-1.5 rounded-md border border-strong bg-bg-tertiary px-2.5 py-2 shadow-panel', className)}
      data-download-url={src}
      data-download-name={title || 'audio'}
    >
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={sync}
        onTimeUpdate={sync}
        onPlay={sync}
        onPause={sync}
        onVolumeChange={sync}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onError={onError}
      />

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-label font-medium text-text-secondary">{title}</span>
        <span className="flex-none select-none text-caption tabular-nums text-text-muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={playing ? 'Pausar' : 'Reproduzir'}
          onClick={togglePlay}
          className="flex size-8 flex-none items-center justify-center rounded-full bg-blurple text-white transition-colors hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>

        <Slider
          value={[duration ? currentTime : 0]}
          min={0}
          max={duration || 1}
          step={0.1}
          disabled={!duration}
          onValueChange={(value) => seek(value)}
          className="min-w-0 flex-1 [&_[data-slot=slider-range]]:bg-blurple [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-track]]:bg-bg-hover"
        />

        <div className="flex flex-none items-center gap-0.5">
          <MediaButton
            label={muted || volume === 0 ? 'Desmutar' : 'Mutar'}
            onClick={toggleMute}
            className="text-text-muted hover:text-text-primary"
          >
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </MediaButton>
          <VolumeSlider
            muted={muted}
            volume={volume}
            onChange={setVolume}
            className="hidden @[19rem]/audio:block [&_[data-slot=slider-range]]:bg-text-muted [&_[data-slot=slider-track]]:bg-bg-hover"
          />
          <MediaButton
            label="Baixar"
            onClick={() => downloadFile(src, title || 'audio')}
            className="text-text-muted hover:text-text-primary"
          >
            <Download size={15} />
          </MediaButton>
        </div>
      </div>
    </div>
  );
}
