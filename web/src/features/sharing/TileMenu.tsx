import { useEffect, useState } from 'react';
import { Crosshair, Maximize2, PictureInPicture2, Volume2, VolumeX } from 'lucide-react';
import type { Track as LKTrack } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import type { AnchorRect } from '../../state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { saveCallVolume } from '../settings/useCallVolumePreference';

/** LocalTrack and RemoteTrack (Track's only concrete subclasses) have this
 * method, but the abstract base class doesn't declare it — could import
 * both concrete types, but a local type with just what we use here is
 * simpler. */
type StatsCapableTrack = { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> };

/** Live bitrate of a specific track, via WebRTC's native
 * getRTCStatsReport() — same API on both sides (local: outbound-rtp/
 * bytesSent, remote: inbound-rtp/bytesReceived), just a different field name. */
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
  } catch { /* ok */ }
  return 0;
}

/** Base UI accepts a "virtual element" (just needs getBoundingClientRect)
 * as the menu's anchor — fits directly into the rectangle already computed
 * on right-click or the gear button, no real Trigger needed. */
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

export function TileMenu() {
  const { state, dispatch, menuTarget, closeTileMenu, tileDomRegistry, audioRegistry, showStats } = useRoom();
  const [sliderValue, setSliderValue] = useState(0);
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const key = menuTarget?.key ?? null;
  const participantId = menuTarget?.participantId ?? null;
  const kind = menuTarget?.kind ?? null;
  const isMe = participantId !== null && participantId === state.me.id;
  const audioKey = kind === 'screen' ? `${participantId}:screen` : participantId;
  // stable key for persisting the volume (userId, not participantId — see
  // useCallVolumePreference.ts).
  const targetUserId = participantId !== null ? (state.participants.get(participantId)?.userId ?? null) : null;
  const volumeStorageKey = kind === 'screen' ? `${targetUserId}:screen` : targetUserId;

  // the track feeding the bitrate stats below — the same one the Tile of
  // this specific kind is showing.
  const media = useParticipantMedia(participantId ?? '');
  const mainTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : media.micTrack;

  // reads the actual current volume only when the menu opens for a new
  // target (same behavior as before: a snapshot at open time, not a live
  // value synced with the video). audio.muted here does NOT factor in —
  // that's just the autoplay block (global, see audioUnlocked in
  // RoomProvider), unrelated to volume; mixing the two made all audio
  // appear "at minimum" until a manual click per tile.
  useEffect(() => {
    if (!key || !audioKey) return;
    const audio = audioRegistry.current.get(audioKey)?.element;
    setSliderValue(audio ? Math.round(audio.volume * 100) : 100);
  }, [key, audioKey, audioRegistry]);

  // live bitrate while the menu stays open: measures the main track's byte
  // delta (native getRTCStatsReport) every 1.5s. Disabled via the general
  // setting (sidebar Settings tab) so it doesn't waste the interval for
  // nothing.
  useEffect(() => {
    if (!key || !showStats || !mainTrack) { setBitrateKbps(0); return; }
    let cancelled = false;
    let lastBytes = 0;
    let lastTime = Date.now();
    getTrackBytes(mainTrack).then((b) => { lastBytes = b; });
    setBitrateKbps(0);
    const interval = setInterval(async () => {
      const now = Date.now();
      const bytes = await getTrackBytes(mainTrack);
      if (cancelled) return;
      const deltaSec = (now - lastTime) / 1000;
      setBitrateKbps(deltaSec > 0 ? Math.max(0, Math.round(((bytes - lastBytes) * 8) / deltaSec / 1000)) : 0);
      lastBytes = bytes;
      lastTime = now;
    }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [key, showStats, mainTrack]);

  useEffect(() => {
    if (!isMe || !showStats || !state.me.sharingSince) { setElapsedSec(0); return; }
    const since = state.me.sharingSince;
    const tick = () => setElapsedSec(Math.floor((Date.now() - since) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isMe, showStats, state.me.sharingSince]);

  if (!menuTarget || !key || !audioKey) return null;

  const handle = tileDomRegistry.current.get(key);
  const hasAudio = !isMe && audioRegistry.current.has(audioKey);
  const isFocused = state.focusedId === key;
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled
    && !!handle?.video && !handle.video.disablePictureInPicture;
  const inPip = pipSupported && document.pictureInPictureElement === handle?.video;

  function toggleFocus() {
    dispatch({ type: 'SET_FOCUSED', id: isFocused ? null : key });
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
    const v = Array.isArray(value) ? (value[0] ?? 0) : (value as number);
    setSliderValue(v);
    const audio = audioRegistry.current.get(audioKey!)?.element;
    if (audio) audio.volume = v / 100;
    if (targetUserId) saveCallVolume(volumeStorageKey!, v / 100);
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
        {hasAudio && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <span className="flex-none text-text-secondary">
                {sliderValue === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </span>
              <Slider value={[sliderValue]} onValueChange={handleVolumeChange} min={0} max={100} />
            </div>
          </>
        )}
        {showStats && (
          <>
            <DropdownMenuSeparator />
            <div className="select-none space-y-0.5 px-2.5 py-2 text-caption text-text-muted">
              <div>Bitrate: {bitrateKbps} kbps</div>
              {isMe && <div>No ar: {formatElapsed(elapsedSec)}</div>}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
