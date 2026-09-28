import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import { ConnectionQuality } from 'livekit-client';
import { EyeOff, HeadphoneOff, Loader2, MicOff, Settings, SignalLow, SignalZero, VolumeX } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack, useIsSpeaking, useConnectionQuality } from './useLiveKitTrack';
import { useMuteForMe } from './useMuteForMe';
import { tileKey } from './tileTypes';
import type { TileKind } from './tileTypes';
import { Avatar, colorFor } from '../../shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

interface TileProps {
  participantId: string;
  kind: TileKind;
  isMine: boolean;
  /** Publication exists and isn't muted, but its track hasn't attached yet —
   * see TileDescriptor. Only meaningful while `kind === 'avatar'`. */
  loading?: boolean;
  fit?: 'cover' | 'contain';
  avatarSize?: number;
  nameSize?: 'body' | 'label';
}

export function Tile({ participantId, kind, isMine, loading = false, fit = 'contain', avatarSize = 96, nameSize = 'body' }: TileProps) {
  const { state, dispatch, openTileMenu, tileDomRegistry, deafened, showTileBanners, mirrorCameraPreview } = useRoom();
  const key = tileKey(participantId, kind);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [containSize, setContainSize] = useState<{ w: number; h: number } | null>(null);

  const participant = isMine ? null : state.participants.get(participantId);
  const name = isMine ? state.me.displayName : (participant?.displayName ?? '');
  const avatar = isMine ? state.me.avatar : (participant?.avatar ?? '');
  const avatarPoster = isMine ? state.me.avatarPoster : (participant?.avatarPoster ?? '');
  const avatarColor = isMine ? state.me.avatarColor : (participant?.avatarColor ?? '');
  const banner = showTileBanners ? (isMine ? state.me.banner : (participant?.banner ?? '')) : '';
  const bannerPoster = showTileBanners ? (isMine ? state.me.bannerPoster : (participant?.bannerPoster ?? '')) : '';
  const isDeafened = isMine ? deafened : (participant?.deafened ?? false);

  const media = useParticipantMedia(participantId);
  const isSpeaking = useIsSpeaking(participantId);
  const connectionQuality = useConnectionQuality(participantId);
  const { hasAudio: hasMutableAudio, muted: mutedForMe, toggleMute: toggleMuteForMe } = useMuteForMe(participantId, kind, isMine);

  // "Ocultar vídeo para mim" — presentation only: never unsubscribes or
  // touches anyone else's view (see TileMenu.tsx). Not offered for your own
  // camera (that's what turning it off is for) or for screens.
  const hiddenForMe = kind === 'camera' && !isMine && state.hiddenVideoKeys.has(key);
  const showsVideo = kind !== 'avatar' && !hiddenForMe;
  const videoTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : null;
  useAttachTrack(videoTrack, videoRef);

  const showSpeakingBorder = kind !== 'screen' && isSpeaking;
  const tint = colorFor(participantId, avatarColor);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    tileDomRegistry.current.set(key, { root, video: showsVideo ? videoRef.current : null });
    return () => { tileDomRegistry.current.delete(key); };
  }, [key, showsVideo, videoTrack, tileDomRegistry]);

  useEffect(() => {
    if (fit !== 'contain' || !showsVideo) { setContainSize(null); return; }
    const root = rootRef.current;
    const video = videoRef.current;
    const parent = root?.parentElement;
    if (!root || !video || !parent) return;

    function recompute() {
      const ratio = video!.videoWidth && video!.videoHeight ? video!.videoWidth / video!.videoHeight : 16 / 9;
      const { width: pw, height: ph } = parent!.getBoundingClientRect();
      let w = pw;
      let h = w / ratio;
      if (h > ph) { h = ph; w = h * ratio; }
      setContainSize({ w, h });
    }

    recompute();
    video.addEventListener('loadedmetadata', recompute);
    video.addEventListener('resize', recompute);
    const ro = new ResizeObserver(recompute);
    ro.observe(parent);
    return () => {
      video.removeEventListener('loadedmetadata', recompute);
      video.removeEventListener('resize', recompute);
      ro.disconnect();
    };
  }, [fit, showsVideo, videoTrack]);

  const isFocused = state.focusedId === key;

  const handleClick = useCallback(() => {
    dispatch({ type: 'SET_FOCUSED', id: state.focusedId === key ? null : key, origin: 'manual' });
  }, [dispatch, key, state.focusedId]);

  // Enter/Space on the tile itself toggle focus, same as a click — but not
  // when they land on a nested real <button> (gear, unmute), which already
  // handles its own activation and would otherwise double-fire.
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleClick();
  }, [handleClick]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTileMenu(key, participantId, kind, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [key, participantId, kind, openTileMenu]);

  const handleGearClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    openTileMenu(key, participantId, kind, e.currentTarget.getBoundingClientRect());
  }, [key, participantId, kind, openTileMenu]);

  const handleUnmuteClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    toggleMuteForMe();
  }, [toggleMuteForMe]);

  // A banner replaces the flat tint (still shown as letterbox filler behind
  // a `contain`-fit camera track, same as the tint was). Rendered as its
  // own absolutely-positioned layer (not the root's own background) so the
  // root's `border` + `border-radius` + `overflow-hidden` never have to
  // reconcile with a background-image's own box/clip math on the SAME
  // element — that combination was leaving a hairline gap at the rounded
  // corners where the overlay wasn't fully covering the image underneath.
  const rootStyle = kind === 'screen' || banner
    ? undefined
    : { background: `color-mix(in srgb, ${tint} 22%, var(--color-bg-tertiary))` };
  // Freezes on the static poster frame until the person actually speaks —
  // same idea as Discord's animated-avatar-while-talking — falling back to
  // the live banner itself when there's no poster (a non-animated banner,
  // or one predating this feature).
  const bannerSrc = !isSpeaking && bannerPoster ? bannerPoster : banner;
  const bannerLayerStyle = banner
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.8)), url(${JSON.stringify(bannerSrc)})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-pressed={isFocused}
      aria-label={`${isFocused ? 'Desfazer destaque de' : 'Destacar'} ${name || 'participante'}`}
      className={`tile-fullscreen-target relative h-full w-full cursor-pointer overflow-hidden rounded-xl border-[3.5px] bg-bg-tertiary transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        showSpeakingBorder ? '' : 'border-transparent'
      }`}
      style={{
        ...rootStyle,
        ...(fit === 'contain' && containSize ? { width: containSize.w, height: containSize.h } : {}),
        ...(showSpeakingBorder ? { borderColor: tint } : {}),
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {kind !== 'screen' && banner && <div className="absolute inset-0" style={bannerLayerStyle} />}
      {showsVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMine}
          className={`relative h-full w-full object-cover ${kind === 'screen' ? 'bg-bg-call' : ''}`}
          // presentation only — the track actually published/sent is never touched
          style={isMine && kind === 'camera' && mirrorCameraPreview ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-2.5">
          <Avatar id={participantId} name={name} avatar={avatar} poster={avatarPoster} frozen={!isSpeaking} avatarColor={avatarColor} size={avatarSize} className={loading ? 'opacity-50' : undefined} />
          {/* the camera is on and about to show video — just not here yet
              (still subscribing); a plain avatar would read as "camera off" */}
          {loading && (
            <span aria-hidden className="absolute" style={{ width: avatarSize, height: avatarSize }}>
              <Loader2 size={Math.max(20, avatarSize / 3)} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-text-muted" />
            </span>
          )}
          {/* distinct from "camera off": their camera is on, this viewer just
              chose not to see it — TileMenu's "Ocultar vídeo para mim" */}
          {hiddenForMe && (
            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-caption text-text-muted">
              <EyeOff size={12} />
              Vídeo oculto
            </span>
          )}
        </div>
      )}

      <div className={cn(
        'absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1.5 rounded-[9px] border border-white/10 bg-black/85 py-1 pr-2.5',
        showsVideo ? 'pl-1' : 'pl-2.5'
      )}>
        {showsVideo && <Avatar id={participantId} name={name} avatar={avatar} poster={avatarPoster} frozen={!isSpeaking} avatarColor={avatarColor} size={20} />}
        <span className={cn('select-none truncate font-medium text-text-primary', nameSize === 'label' ? 'text-label' : 'text-caption')}>{name}</span>
        {isDeafened ? (
          <HeadphoneOff size={14} className="flex-none text-red" />
        ) : (
          kind !== 'screen' && media.micMuted && (
            <MicOff size={14} className="flex-none text-red" />
          )
        )}
        {kind !== 'screen' && connectionQuality === ConnectionQuality.Poor && (
          <SignalLow size={14} className="flex-none text-yellow" />
        )}
        {kind !== 'screen' && connectionQuality === ConnectionQuality.Lost && (
          <SignalZero size={14} className="flex-none text-red" />
        )}
      </div>

      {/* one grouped pill for tile-level actions, not separate floating
          buttons — a thin divider only appears when there's more than one */}
      <div className="absolute left-1.5 top-1.5 flex h-6 items-stretch divide-x divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-black/85">
        {hasMutableAudio && mutedForMe && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reativar áudio"
            onClick={handleUnmuteClick}
            className="h-full w-7 rounded-none text-red hover:bg-white/10 hover:text-red"
          >
            <VolumeX size={14} />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Configurações da transmissão"
          onClick={handleGearClick}
          className="h-full w-7 rounded-none text-white/90 hover:bg-white/10 hover:text-white"
        >
          <Settings size={14} />
        </Button>
      </div>
    </div>
  );
}
