import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Maximize2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/shared/lib/utils';

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

function TimeReadout({ currentTime, duration }: { currentTime: number; duration: number }) {
  return (
    <span className="w-23 flex-none select-none text-center text-caption tabular-nums text-text-muted">
      {formatTime(currentTime)} / {formatTime(duration)}
    </span>
  );
}

function MediaButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={onClick}
      className="flex-none text-text-secondary hover:bg-white/10 hover:text-text-primary"
    >
      {children}
    </Button>
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
          <div className="w-full max-w-6xl cursor-default" onClick={(event) => event.stopPropagation()}>
            <VideoPlayerInner src={src} poster={poster} title={title} className="max-w-none border-0 shadow-popover" />
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

  function expand() {
    ref.current?.pause();
    onExpand?.();
  }

  return (
    <div className={cn('group/player relative aspect-video w-full max-w-sm overflow-hidden rounded-md border border-strong bg-black shadow-panel', className)}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={src}
        poster={poster || undefined}
        preload="metadata"
        playsInline
        title={title}
        onLoadedMetadata={sync}
        onTimeUpdate={sync}
        onPlay={sync}
        onPause={sync}
        onVolumeChange={sync}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onError={onError}
        className="h-full w-full object-contain"
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
          className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-popover transition-colors hover:bg-blurple focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Play size={22} fill="currentColor" />
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2 pb-2 pt-8 opacity-100 transition-opacity md:opacity-0 md:group-hover/player:opacity-100 md:group-focus-within/player:opacity-100">
        <Slider
          value={[duration ? currentTime : 0]}
          min={0}
          max={duration || 1}
          step={0.1}
          disabled={!duration}
          onValueChange={(value) => seek(value)}
          className="[&_[data-slot=slider-range]]:bg-blurple [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-track]]:bg-white/25"
        />
        <div className="flex items-center gap-1">
          <MediaButton label={playing ? 'Pausar' : 'Reproduzir'} onClick={togglePlay}>
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </MediaButton>
          <TimeReadout currentTime={currentTime} duration={duration} />
          <div className="ml-auto flex items-center gap-1">
            <MediaButton label={muted || volume === 0 ? 'Desmutar' : 'Mutar'} onClick={toggleMute}>
              {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </MediaButton>
            <Slider
              value={[muted ? 0 : Math.round(volume * 100)]}
              min={0}
              max={100}
              step={1}
              onValueChange={(value) => setVolume(value)}
              className="hidden w-18 [&_[data-slot=slider-range]]:bg-text-secondary [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-track]]:bg-white/25 sm:block"
            />
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
    <div className={cn('grid w-full max-w-xl min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-md border border-strong bg-bg-tertiary px-2.5 py-2 shadow-panel sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]', className)}>
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
      <MediaButton label={playing ? 'Pausar' : 'Reproduzir'} onClick={togglePlay}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </MediaButton>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <span className="truncate text-label font-medium text-text-secondary">{title}</span>}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <Slider
            value={[duration ? currentTime : 0]}
            min={0}
            max={duration || 1}
            step={0.1}
            disabled={!duration}
            onValueChange={(value) => seek(value)}
            className="min-w-0 [&_[data-slot=slider-range]]:bg-blurple [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-track]]:bg-bg-hover"
          />
          <TimeReadout currentTime={currentTime} duration={duration} />
        </div>
      </div>
      <MediaButton label={muted || volume === 0 ? 'Desmutar' : 'Mutar'} onClick={toggleMute}>
        {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </MediaButton>
      <Slider
        value={[muted ? 0 : Math.round(volume * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={(value) => setVolume(value)}
        className="hidden w-16 flex-none [&_[data-slot=slider-range]]:bg-text-secondary [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-track]]:bg-bg-hover sm:block"
      />
    </div>
  );
}
