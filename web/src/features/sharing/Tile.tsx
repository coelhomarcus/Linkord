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
  /** 'cover' (default — grid, thumbnails, PiP): the cell is whatever size
   * the layout dictates, and the video fills it by cropping the excess —
   * right for small tiles, where cropping beats leftover space. 'contain'
   * (focused tile): the BOX (not just the video) resizes to fit the
   * video's real ratio within the available space — since there's never
   * leftover space inside the box, the badges (name/gear) and rounded
   * corners always sit on top of the actual image. */
  fit?: 'cover' | 'contain';
  /** Large centered avatar (only shows when kind==='avatar', camera off) —
   * the tile doesn't know its own rendered size (the parent decides, via
   * inline width/height), so this has to come from outside. Default is
   * tuned for grid/focus; the focus-mode thumbnail strip passes a smaller
   * value (see TileGrid) — without it, a fixed 80px inside a 90px-tall
   * thumbnail looked huge, almost the size of the whole cell. */
  avatarSize?: number;
  /** Name size in the bottom pill — 'body' (default, grid/thumbnails) or
   * 'label' (one step smaller, used on the LARGE focused tile: it fills
   * almost the whole screen, so the same text that's proportional in a
   * small grid cell looks oversized there). */
  nameSize?: 'body' | 'label';
}

export function Tile({ participantId, kind, isMine, fit = 'cover', avatarSize = 80, nameSize = 'body' }: TileProps) {
  const { state, dispatch, openTileMenu, tileDomRegistry, deafened } = useRoom();
  const key = tileKey(participantId, kind);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [containSize, setContainSize] = useState<{ w: number; h: number } | null>(null);

  const participant = isMine ? null : state.participants.get(participantId);
  const name = isMine ? state.me.name : (participant?.name ?? '');
  const avatar = isMine ? state.me.avatar : (participant?.avatar ?? '');
  // deafened has no LiveKit track — for myself it's local state (instant),
  // for others it comes from the Participant the server relays.
  const isDeafened = isMine ? deafened : (participant?.deafened ?? false);

  const media = useParticipantMedia(participantId);
  const isSpeaking = useIsSpeaking(participantId);

  const showsVideo = kind !== 'avatar';
  const videoTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : null;
  useAttachTrack(videoTrack, videoRef);

  // reactive speaking border: only on the "person" tile (camera/avatar) —
  // speaking shouldn't highlight the shared screen.
  const showSpeakingBorder = kind !== 'screen' && isSpeaking;
  const tint = colorFor(participantId);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    tileDomRegistry.current.set(key, { root, video: showsVideo ? videoRef.current : null });
    return () => { tileDomRegistry.current.delete(key); };
  }, [key, showsVideo, videoTrack, tileDomRegistry]);

  // fit="contain": computes the exact size the BOX (not just the video)
  // needs to fit without cropping, at the video's real ratio, within the
  // space the parent actually has — the same math object-fit:contain would
  // do, applied to the whole box instead of just the video. Reacts to: the
  // parent resizing (window resize, chat opening/closing) and the video's
  // ratio changing (metadata loads, or a stream that changes resolution
  // mid-session).
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
    // without this the click would bubble up to GlobalContextMenu
    // (App.tsx) and open both menus at once.
    e.stopPropagation();
    openTileMenu(key, participantId, kind, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [key, participantId, kind, openTileMenu]);

  const handleGearClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    openTileMenu(key, participantId, kind, e.currentTarget.getBoundingClientRect());
  }, [key, participantId, kind, openTileMenu]);

  const rootStyle = kind === 'screen'
    ? undefined
    : { background: `color-mix(in srgb, ${tint} 22%, var(--color-bg-tertiary))` };

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
      {showsVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isMine} className={`h-full w-full object-cover ${kind === 'screen' ? 'bg-black' : ''}`} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5">
          <Avatar id={participantId} name={name} avatar={avatar} size={avatarSize} />
        </div>
      )}

      <div className={cn(
        'absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-bg-tertiary/85 py-1 pr-2.5',
        // pl-1 only makes sense to "hug" the 20px avatar right after it —
        // without it, the text deserves the same breathing room as the
        // right side (pr-2.5), or it'd stick to the pill's left edge.
        showsVideo ? 'pl-1' : 'pl-2.5'
      )}>
        {/* only shows the avatar here for VIDEO tiles (camera/screen) — it's
            the only visual reference to who it is in those cases. On a
            kind==='avatar' tile the LARGE avatar already fills the whole
            body above, repeating it here (small) would be redundant. */}
        {showsVideo && <Avatar id={participantId} name={name} avatar={avatar} size={20} />}
        <span className={cn('select-none truncate font-medium text-text-primary', nameSize === 'label' ? 'text-label' : 'text-body')}>{name}</span>
        {/* "meta" icons — only show when NOT redundant with what this
            specific tile already displays (e.g. doesn't repeat camera-on
            on the camera tile itself), signaling the person has ANOTHER
            active stream on some other tile. */}
        {kind !== 'camera' && !!media.cameraTrack && <Video size={14} className="flex-none text-green" />}
        {kind !== 'screen' && !!media.screenTrack && <ScreenShare size={14} className="flex-none text-blurple" />}
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
        className="absolute right-2 top-2 bg-bg-tertiary/75 text-text-primary hover:bg-blurple"
      >
        <Settings size={14} />
      </Button>
    </div>
  );
}
