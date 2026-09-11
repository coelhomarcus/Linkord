import { useEffect, useRef, useState } from 'react';
import { Crosshair, Maximize2, PictureInPicture2, UserX, Volume2, VolumeX } from 'lucide-react';
import type { Track as LKTrack } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import type { AnchorRect } from '../../state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { saveCallVolume } from '../settings/useCallVolumePreference';

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
  const { state, dispatch, menuTarget, closeTileMenu, tileDomRegistry, audioRegistry, showStats, kickFromCall, activeCallConversationId, conversations } = useRoom();
  const [sliderValue, setSliderValue] = useState(0);
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  // What the mute-toggle button restores to — the target's own volume when
  // the menu opened if it was already above 0, else 40% (there's nothing
  // meaningful to "go back to" if it was already at/left at 0).
  const unmuteToRef = useRef(40);

  const key = menuTarget?.key ?? null;
  const participantId = menuTarget?.participantId ?? null;
  const kind = menuTarget?.kind ?? null;
  const isMe = participantId !== null && participantId === state.me.id;
  const audioKey = kind === 'screen' ? `${participantId}:screen` : participantId;
  const targetUserId = participantId !== null ? (state.participants.get(participantId)?.userId ?? null) : null;
  const volumeStorageKey = kind === 'screen' ? `${targetUserId}:screen` : targetUserId;

  const media = useParticipantMedia(participantId ?? '');
  const mainTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : media.micTrack;

  useEffect(() => {
    if (!key || !audioKey) return;
    const audio = audioRegistry.current.get(audioKey)?.element;
    const initial = audio ? Math.round(audio.volume * 100) : 100;
    setSliderValue(initial);
    unmuteToRef.current = initial > 0 ? initial : 40;
  }, [key, audioKey, audioRegistry]);

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
  // "Remove from call" is a group-moderation power — not offered for 1:1
  // direct calls, where "leave call" already covers it (mirrors the
  // server-side check in modules/moderation.ts#handleCallKick).
  const isGroupCall = conversations.find((c) => c.id === activeCallConversationId)?.type === 'group';
  const canKick = !isMe && isGroupCall && state.me.role === 'admin';
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
    if (v > 0) unmuteToRef.current = v;
    const audio = audioRegistry.current.get(audioKey!)?.element;
    if (audio) audio.volume = v / 100;
    if (targetUserId) saveCallVolume(volumeStorageKey!, v / 100);
  }
  function toggleMute() {
    handleVolumeChange(sliderValue > 0 ? 0 : unmuteToRef.current);
  }
  function handleKick() {
    if (participantId) kickFromCall(participantId);
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
              <button
                type="button"
                onClick={toggleMute}
                aria-label={sliderValue === 0 ? 'Reativar audio' : 'Silenciar audio'}
                className="flex-none text-text-secondary transition-colors hover:text-text-primary"
              >
                {sliderValue === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
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
