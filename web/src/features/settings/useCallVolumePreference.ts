/** Per-person/stream volume in a call (mic or shared screen audio),
 * persisted in localStorage — without this, every remote audio resets to
 * max on each reload (see ParticipantAudioLayer/TileMenu). Key: userId
 * (stable across reconnects/tabs) for the mic, `${userId}:screen` for
 * screen audio — same suffix scheme audioKey/audioRegistry already use,
 * just swapping participantId (LiveKit identity, changes on every
 * connection) for userId. */

const CALL_VOLUME_KEY = 'ss-call-volumes';

function loadAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CALL_VOLUME_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadCallVolume(key: string): number {
  const v = loadAll()[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

export function saveCallVolume(key: string, value: number): void {
  const all = loadAll();
  all[key] = value;
  localStorage.setItem(CALL_VOLUME_KEY, JSON.stringify(all));
}
