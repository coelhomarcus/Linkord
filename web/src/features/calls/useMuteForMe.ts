import { useEffect, useRef, useState } from 'react';
import { useRoom } from '../../state/RoomContext';
import type { TileKind } from './tileTypes';
import { saveCallVolume } from '../settings/useCallVolumePreference';

// Local (per-viewer) mute/volume for a participant's stream — mirrors the
// slider in TileMenu. `audio.volume` is the source of truth; this hook just
// mirrors it into React state via the native `volumechange` event so any
// component (the tile's own indicator button, the settings menu) can read
// and drive the same value without duplicating the mute/restore semantics.
export function useMuteForMe(participantId: string | null, kind: TileKind, isMine: boolean) {
  const { state, audioRegistry } = useRoom();
  const audioKey = participantId === null ? null : (kind === 'screen' ? `${participantId}:screen` : participantId);
  const targetUserId = participantId !== null ? (state.participants.get(participantId)?.userId ?? null) : null;
  const volumeStorageKey = targetUserId ? (kind === 'screen' ? `${targetUserId}:screen` : targetUserId) : null;
  const hasAudio = !isMine && !!audioKey && audioRegistry.current.has(audioKey);

  const [volume, setVolumeState] = useState(0);
  // What the mute-toggle restores to — the last volume above 0, or 40% if
  // there's nothing meaningful to go back to.
  const unmuteToRef = useRef(40);

  useEffect(() => {
    if (!audioKey) return;
    const audio = audioRegistry.current.get(audioKey)?.element;
    if (!audio) return;
    const sync = () => {
      const v = Math.round(audio.volume * 100);
      setVolumeState(v);
      if (v > 0) unmuteToRef.current = v;
    };
    sync();
    audio.addEventListener('volumechange', sync);
    return () => audio.removeEventListener('volumechange', sync);
  }, [audioKey, audioRegistry, hasAudio]);

  function setVolume(value: number) {
    if (!audioKey) return;
    const v = Math.max(0, Math.min(100, value));
    if (v > 0) unmuteToRef.current = v;
    const audio = audioRegistry.current.get(audioKey)?.element;
    if (audio) audio.volume = v / 100;
    setVolumeState(v);
    if (volumeStorageKey) saveCallVolume(volumeStorageKey, v / 100);
  }

  function toggleMute() {
    setVolume(volume > 0 ? 0 : unmuteToRef.current);
  }

  return { hasAudio, volume, muted: volume === 0, setVolume, toggleMute };
}
