import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { HeadphoneOff, MicOff, ScreenShare, Settings, Video } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack, useIsSpeaking } from './useLiveKitTrack';
import { tileKey } from './tileTypes';
import type { TileKind } from './tileTypes';
import { Avatar, colorFor } from '../../shared/Avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

interface TileProps {
  participantId: string;
  kind: TileKind;
  isMine: boolean;
  fit?: 'cover' | 'contain';
  avatarSize?: number;
  nameSize?: 'body' | 'label';
}

export function Tile({ participantId, kind, isMine, fit = 'cover', avatarSize = 96, nameSize = 'body' }: TileProps) {
  const { state, dispatch, openTileMenu, tileDomRegistry, deafened } = useRoom();
  const key = tileKey(participantId, kind);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [containSize, setContainSize] = useState<{ w: number; h: number } | null>(null);

  const participant = isMine ? null : state.participants.get(participantId);
  const name = isMine ? state.me.displayName : (participant?.displayName ?? '');
  const avatar = isMine ? state.me.avatar : (participant?.avatar ?? '');
  const avatarColor = isMine ? state.me.avatarColor : (participant?.avatarColor ?? '');
  const banner = isMine ? state.me.banner : (participant?.banner ?? '');
  const isDeafened = isMine ? deafened : (participant?.deafened ?? false);

  const media = useParticipantMedia(participantId);
  const isSpeaking = useIsSpeaking(participantId);

  const showsVideo = kind !== 'avatar';
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

  const handleClick = useCallback(() => {
    dispatch({ type: 'SET_FOCUSED', id: state.focusedId === key ? null : key });
  }, [dispatch, key, state.focusedId]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTileMenu(key, participantId, kind, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [key, participantId, kind, openTileMenu]);

  const handleGearClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    openTileMenu(key, participantId, kind, e.currentTarget.getBoundingClientRect());
  }, [key, participantId, kind, openTileMenu]);

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
  const bannerLayerStyle = banner
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.45)), url(${JSON.stringify(banner)})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      className={`tile-fullscreen-target relative h-full w-full cursor-pointer overflow-hidden rounded-xl border bg-bg-tertiary transition-colors ${
        showSpeakingBorder ? '' : 'border-transparent'
      }`}
      style={{
        ...rootStyle,
        ...(fit === 'contain' && containSize ? { width: containSize.w, height: containSize.h } : {}),
        ...(showSpeakingBorder ? { borderColor: tint } : {}),
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {kind !== 'screen' && banner && <div className="absolute inset-0" style={bannerLayerStyle} />}
      {showsVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isMine} className={`h-full w-full object-cover ${kind === 'screen' ? 'bg-black' : ''}`} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5">
          <Avatar id={participantId} name={name} avatar={avatar} avatarColor={avatarColor} size={avatarSize} />
        </div>
      )}

      <div className={cn(
        'absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-bg-tertiary/85 py-1 pr-2.5',
        showsVideo ? 'pl-1' : 'pl-2.5'
      )}>
        {showsVideo && <Avatar id={participantId} name={name} avatar={avatar} avatarColor={avatarColor} size={20} />}
        <span className={cn('select-none truncate font-medium text-text-primary', nameSize === 'label' ? 'text-label' : 'text-body')}>{name}</span>
        {kind !== 'camera' && !!media.cameraTrack && <Video size={14} className="flex-none text-green" />}
        {kind !== 'screen' && !!media.screenTrack && <ScreenShare size={14} className="flex-none text-primary" />}
        {isDeafened ? (
          <HeadphoneOff size={14} className="flex-none text-red" />
        ) : (
          kind !== 'screen' && media.micActivated && media.micMuted && (
            <MicOff size={14} className="flex-none text-red" />
          )
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Configuracoes da transmissao"
        onClick={handleGearClick}
        className="absolute right-2 top-2 bg-bg-tertiary/75 text-text-primary hover:bg-primary"
      >
        <Settings size={14} />
      </Button>
    </div>
  );
}
