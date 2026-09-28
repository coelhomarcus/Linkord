import { useEffect, useRef, useState } from 'react';
import {
  Crosshair, Eye, EyeOff, FlipHorizontal, Gauge, Maximize2, MonitorX, Pause, PictureInPicture2, Play,
  RefreshCw, User, UserX, VideoOff, Volume2, VolumeX,
} from 'lucide-react';
import type { Track as LKTrack } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import type { AnchorRect } from '../../state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import { useMuteForMe } from './useMuteForMe';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { Slider } from '@/shared/ui/primitives/slider';
import { canKickFromTile } from './canKickFromTile';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';

type StatsCapableTrack = { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> };

async function getTrackBytes(track: LKTrack | null): Promise<number> {
  if (!track) return 0;
  try {
    const report = await (track as unknown as StatsCapableTrack).getRTCStatsReport?.();
    if (!report) return 0;
    for (const stat of report.values()) {
      const s = stat as RTCStats & { bytesSent?: number; bytesReceived?: number };
      if (s.type === 'outbound-rtp' && typeof s.bytesSent === 'number') return s.bytesSent;
      if (s.type === 'inbound-rtp' && typeof s.bytesReceived === 'number') return s.bytesReceived;
    }
  } catch {  }
  return 0;
}

/** Width/height straight off the media track — never inferred, never a
 * made-up placeholder when it isn't available yet (see the redesign plan
 * §9.4: "ausência de estatística não vira zero inventado"). */
function getVideoResolution(track: LKTrack | null): string | null {
  const settings = track?.mediaStreamTrack?.getSettings();
  return settings?.width && settings.height ? `${settings.width}×${settings.height}` : null;
}

function rectToVirtualElement(rect: AnchorRect) {
  return {
    getBoundingClientRect: (): DOMRect => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      toJSON() {
        return this;
      },
    }),
  };
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export interface TileMenuProps {
  onOpenProfile: (userId: string) => void;
}

export function TileMenu({ onOpenProfile }: TileMenuProps) {
  const {
    state, dispatch, menuTarget, closeTileMenu, tileDomRegistry, showStats, kickFromCall,
    activeCallConversationId, conversations, mirrorCameraPreview, setMirrorCameraPreview, stopCamera,
    stopSharing, changeSource, pauseSharePreview, resumeSharePreview, shareQuality, setShareQuality,
  } = useRoom();
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [resolution, setResolution] = useState<string | null>(null);

  const key = menuTarget?.key ?? null;
  const participantId = menuTarget?.participantId ?? null;
  const kind = menuTarget?.kind ?? null;
  const isMe = participantId !== null && participantId === state.me.id;
  const targetUserId = isMe ? state.me.userId : (participantId ? state.participants.get(participantId)?.userId : undefined);

  const media = useParticipantMedia(participantId ?? '');
  const mainTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : media.micTrack;
  const { hasAudio, volume, muted, setVolume, toggleMute } = useMuteForMe(participantId, kind ?? 'camera', isMe);

  // Closes the menu when its target stops making sense — the participant
  // left, this specific source ended (camera/share stopped), or the call
  // itself changed — instead of leaving stale actions operable on a target
  // that's gone (plan §9.3: "alvo que saiu não continua operável"). Skips
  // the render right after opening on a new target: useParticipantMedia
  // starts empty and syncs a tick later, which would otherwise read as
  // "the source just ended" the instant the menu opens.
  const openedConversationIdRef = useRef<string | null>(null);
  const lastCheckedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!menuTarget || !participantId) { lastCheckedKeyRef.current = null; return; }
    if (lastCheckedKeyRef.current !== menuTarget.key) {
      lastCheckedKeyRef.current = menuTarget.key;
      openedConversationIdRef.current = activeCallConversationId;
      return;
    }
    const participantGone = !isMe && !state.participants.has(participantId);
    // A paused screen (media.screenTrack null because muted, not gone — see
    // useScreenShare's pauseSharePreview) must NOT read as "ended": that's
    // the exact state this menu's own "Pausar prévia" action puts it in.
    const sourceEnded = (kind === 'camera' && !media.cameraTrack) || (kind === 'screen' && !media.screenTrack && !media.screenPaused);
    const conversationChanged = activeCallConversationId !== openedConversationIdRef.current;
    if (participantGone || sourceEnded || conversationChanged) closeTileMenu();
  }, [menuTarget, participantId, isMe, kind, state.participants, media.cameraTrack, media.screenTrack, media.screenPaused, activeCallConversationId, closeTileMenu]);

  useEffect(() => {
    if (!key || !showStats || !mainTrack) { setBitrateKbps(0); setResolution(null); return; }
    let cancelled = false;
    let lastBytes = 0;
    let lastTime = Date.now();
    getTrackBytes(mainTrack).then((b) => { lastBytes = b; });
    setBitrateKbps(0);
    setResolution(kind !== 'avatar' ? getVideoResolution(mainTrack) : null);
    const interval = setInterval(async () => {
      const now = Date.now();
      const bytes = await getTrackBytes(mainTrack);
      if (cancelled) return;
      const deltaSec = (now - lastTime) / 1000;
      setBitrateKbps(deltaSec > 0 ? Math.max(0, Math.round(((bytes - lastBytes) * 8) / deltaSec / 1000)) : 0);
      lastBytes = bytes;
      lastTime = now;
      if (kind !== 'avatar') setResolution(getVideoResolution(mainTrack));
    }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [key, showStats, mainTrack, kind]);

  useEffect(() => {
    if (!isMe || !showStats || !state.me.sharingSince) { setElapsedSec(0); return; }
    const since = state.me.sharingSince;
    const tick = () => setElapsedSec(Math.floor((Date.now() - since) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isMe, showStats, state.me.sharingSince]);

  if (!menuTarget || !key || !participantId) return null;

  const handle = tileDomRegistry.current.get(key);
  const isFocused = state.focusedId === key;
  const isHiddenForMe = state.hiddenVideoKeys.has(key);
  const isNotWatching = state.unwatchedScreenKeys.has(key);
  const isSharePaused = media.screenPaused;
  // "Remove from call" is a group-moderation power — not offered for 1:1
  // direct calls, where "leave call" already covers it (mirrors the
  // server-side check in modules/moderation.ts#handleCallKick).
  const canKick = canKickFromTile({
    isMe,
    conversation: conversations.find((c) => c.id === activeCallConversationId),
    meIsAdmin: state.me.role === 'admin',
    targetUserId: participantId ? state.participants.get(participantId)?.userId : undefined,
  });
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled
    && !!handle?.video && !handle.video.disablePictureInPicture;
  const inPip = pipSupported && document.pictureInPictureElement === handle?.video;

  function toggleFocus() {
    dispatch({ type: 'SET_FOCUSED', id: isFocused ? null : key!, origin: 'manual' });
  }
  function goFullscreen() {
    handle?.root.requestFullscreen?.().catch(() => {});
  }
  function togglePip() {
    if (!handle?.video) return;
    if (document.pictureInPictureElement === handle.video) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      handle.video.requestPictureInPicture().catch(() => {});
    }
  }
  function handleVolumeChange(value: number | readonly number[]) {
    setVolume(Array.isArray(value) ? (value[0] ?? 0) : (value as number));
  }
  function handleKick() {
    if (participantId) kickFromCall(participantId);
    closeTileMenu();
  }
  function handleOpenProfile() {
    if (targetUserId) onOpenProfile(targetUserId);
    closeTileMenu();
  }
  function handleToggleHiddenForMe() {
    dispatch({ type: 'TOGGLE_HIDDEN_VIDEO', key: key! });
  }
  function handleToggleWatch() {
    dispatch({ type: 'TOGGLE_SCREEN_WATCH', key: key! });
  }
  function handleStopSharing() {
    stopSharing();
    closeTileMenu();
  }

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) closeTileMenu(); }}>
      <DropdownMenuContent
        anchor={rectToVirtualElement(menuTarget.rect)}
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-64"
      >
        <DropdownMenuItem onClick={toggleFocus}>
          <Crosshair size={16} />
              <span>{isFocused ? 'Sair do foco' : 'Focar'}</span>
        </DropdownMenuItem>
        {targetUserId && (
          <DropdownMenuItem onClick={handleOpenProfile}>
            <User size={16} />
            <span>Ver perfil</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={goFullscreen}>
          <Maximize2 size={16} />
          <span>Tela cheia</span>
        </DropdownMenuItem>
        {pipSupported && (
          <DropdownMenuItem onClick={togglePip}>
            <PictureInPicture2 size={16} />
              <span>{inPip ? 'Sair do picture-in-picture' : 'Picture-in-picture'}</span>
          </DropdownMenuItem>
        )}

        {kind === 'camera' && isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setMirrorCameraPreview(!mirrorCameraPreview)}>
              <FlipHorizontal size={16} />
              <span>{mirrorCameraPreview ? 'Parar de espelhar minha prévia' : 'Espelhar minha prévia'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={stopCamera}>
              <VideoOff size={16} />
              <span>Desligar câmera</span>
            </DropdownMenuItem>
          </>
        )}
        {kind === 'camera' && !isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleHiddenForMe}>
              <EyeOff size={16} />
              <span>{isHiddenForMe ? 'Restaurar vídeo' : 'Ocultar vídeo para mim'}</span>
            </DropdownMenuItem>
          </>
        )}
        {kind === 'screen' && isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void changeSource()}>
              <RefreshCw size={16} />
              <span>Trocar fonte</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Gauge size={16} />
                <span>Qualidade</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={shareQuality} onValueChange={(v) => setShareQuality(v as ShareQualityId)}>
                  {(Object.entries(SHARE_QUALITY_PRESETS) as [ShareQualityId, typeof SHARE_QUALITY_PRESETS[ShareQualityId]][]).map(([id, preset]) => (
                    <DropdownMenuRadioItem key={id} value={id}>{preset.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => void (isSharePaused ? resumeSharePreview() : pauseSharePreview())}>
              {isSharePaused ? <Play size={16} /> : <Pause size={16} />}
              <span>{isSharePaused ? 'Retomar prévia' : 'Pausar prévia'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleStopSharing}>
              <MonitorX size={16} />
              <span>Encerrar compartilhamento</span>
            </DropdownMenuItem>
          </>
        )}
        {kind === 'screen' && !isMe && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleWatch}>
              {isNotWatching ? <Eye size={16} /> : <EyeOff size={16} />}
              <span>{isNotWatching ? 'Assistir' : 'Parar de assistir'}</span>
            </DropdownMenuItem>
          </>
        )}

        {hasAudio && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Reativar áudio' : 'Silenciar áudio'}
                className="flex-none text-text-secondary transition-colors hover:text-text-primary"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <Slider value={[volume]} onValueChange={handleVolumeChange} min={0} max={100} />
            </div>
          </>
        )}
        {showStats && (
          <>
            <DropdownMenuSeparator />
            <div className="select-none space-y-0.5 px-2.5 py-2 text-caption text-text-muted">
              <div>Bitrate: {bitrateKbps} kbps</div>
              {resolution && <div>Resolução: {resolution}</div>}
              {isMe && <div>No ar: {formatElapsed(elapsedSec)}</div>}
            </div>
          </>
        )}
        {canKick && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleKick}>
              <UserX size={16} />
              <span>Remover da chamada</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
