import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { updateAvatar } from '../modules/auth/users.js';
import type { AppSocket, HandlerTable, Participant, PublicParticipant } from '../types.js';

// Presence for the single shared room. `id` is per-CONNECTION (used as the
// LiveKit identity) — if it were per-account, a second tab would get the
// same identity and LiveKit would kick the first one. `userId` (the
// account) is what ties reconnection together and lets two tabs coexist.
export const participants = new Map<string, Participant>(); // id -> participant

const newId = () => crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

// external URL (https://...) or one of our own uploads (/uploads/<id>)
const UPLOADED_AVATAR_RE = /^\/uploads\/[0-9a-f]{32}$/;
function sanitizeAvatar(url: unknown): string {
  const s = String(url == null ? '' : url).trim().slice(0, config.MAX_AVATAR_LEN);
  return /^https?:\/\/\S+$/i.test(s) || UPLOADED_AVATAR_RE.test(s) ? s : '';
}

export function publicParticipant(p: Participant): PublicParticipant {
  return { id: p.id, userId: p.userId, name: p.name, avatar: p.avatar, role: p.role, deafened: p.deafened, voiceChannelId: p.voiceChannelId };
}

/** Changes which voice channel `p` is in (or none, with null) and notifies
 * everyone — called from realtime/socket.ts (handleVoiceJoin/Leave) after it
 * validates the channel and mints the token. */
export function setVoiceChannelId(p: Participant, channelId: string | null): void {
  p.voiceChannelId = channelId;
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
}

/** Address of who connected — used for logging only. */
export function ipOf(socket: AppSocket): string {
  if (config.TRUST_PROXY) {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  }
  return socket.handshake.address || '?';
}

export function send(socket: AppSocket | null | undefined, obj: { t: string; [key: string]: unknown }): void {
  if (socket && socket.connected) {
    try { socket.emit(obj.t, obj); } catch { /* socket dying */ }
  }
}

export function broadcast(obj: { t: string; [key: string]: unknown }, exceptId?: string): void {
  for (const p of participants.values()) {
    if (p.id === exceptId) continue;
    if (p.socket && p.socket.connected) { try { p.socket.emit(obj.t, obj); } catch { /* socket dying */ } }
  }
}

/** True if ANY connection for this account has a live socket right now —
 * used for the online/offline directory. Linear scan is fine at this scale. */
export function isUserOnline(userId: string): boolean {
  for (const p of participants.values()) {
    if (p.userId === userId && p.socket) return true;
  }
  return false;
}

/** Snapshot for `welcome` — distinct userIds with a live socket right now
 * (excludes anyone only in the grace window, see isUserOnline). */
export function listOnlineUserIds(): string[] {
  const ids = new Set<string>();
  for (const p of participants.values()) if (p.socket) ids.add(p.userId);
  return [...ids];
}

export function removeParticipant(p: Participant): void {
  if (participants.get(p.id) !== p) return; // already replaced by a reconnect
  if (p.graceTimer) clearTimeout(p.graceTimer);
  participants.delete(p.id);
  broadcast({ t: 'participant-left', id: p.id });
  // only here (not handleClose) to respect the same grace window as
  // 'participant-left' — a brief network drop shouldn't flicker offline.
  if (!isUserOnline(p.userId)) broadcast({ t: 'user-offline', userId: p.userId });
}

/** Removes ghosts (socket=null, stuck in the reconnect grace window) for
 * the SAME account before creating a new connection — otherwise a crashed
 * tab would hold the slot for up to RECONNECT_GRACE_MS. */
function evictGhostsForUser(userId: string): void {
  for (const p of [...participants.values()]) {
    if (p.userId === userId && p.socket === null) removeParticipant(p);
  }
}

interface JoinMessage {
  id?: string;
  token?: string;
}

/** Creates or resumes the connection's participant (same identity if a
 * valid resume token for the SAME account) and sets socket.participantId.
 * The `welcome` message itself is assembled by realtime/socket.ts (which
 * also touches chat/other features) to avoid a cycle. Sends the room-full
 * error and returns null when applicable. */
export function join(socket: AppSocket, msg: JoinMessage): Participant | null {
  if (socket.participantId) return null;
  const u = socket.user; // guaranteed by io.use — no socket exists without a valid session
  // computed BEFORE touching the Map — if this is the account's only
  // connection, it's a transition to "online" the directory needs to know.
  const wasOnline = isUserOnline(u.userId);
  let p: Participant | null = null;
  if (msg.id && msg.token) {
    const existing = participants.get(String(msg.id));
    // checking userId (not just the token) stops a resume token from being
    // reused by a different account.
    if (existing && existing.token === String(msg.token) && existing.userId === u.userId) p = existing;
  }
  if (p) {
    if (p.socket && p.socket !== socket) { try { p.socket.disconnect(true); } catch { /* ja desconectado */ } }
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    p.socket = socket;
  } else {
    if (participants.size >= config.MAX_PARTICIPANTS) {
      send(socket, { t: 'error', code: 'full', message: 'Sala cheia, tente mais tarde.' });
      return null;
    }
    evictGhostsForUser(u.userId);
    p = {
      id: newId(),
      token: newToken(),
      userId: u.userId,
      socket,
      name: u.username,
      avatar: sanitizeAvatar(u.avatar),
      role: u.role,
      // always starts undeafened on a brand NEW connection (client starts
      // the same way); a resume above reuses the existing `p` and
      // PRESERVES the value.
      deafened: false,
      voiceChannelId: null,
      graceTimer: null,
    };
    participants.set(p.id, p);
  }
  socket.participantId = p.id;
  if (!wasOnline) broadcast({ t: 'user-online', userId: u.userId });
  return p;
}

/** Only the avatar is editable — name is the account's immutable username.
 * Persisted to survive reconnects/other tabs (the session cache can take up
 * to 60s to reflect this for a tab that hasn't reconnected yet — the
 * editing tab updates immediately via participant-updated below). */
function handleProfile(socket: AppSocket, msg: { avatar?: string }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const oldAvatar = p.avatar;
  p.avatar = sanitizeAvatar(msg.avatar);
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
  updateAvatar(p.userId, p.avatar).catch((err) => console.error(`[${p.id}] falha ao salvar avatar:`, err instanceof Error ? err.stack : err));
  // deletes the OLD photo file if it was one of our uploads and changed —
  // otherwise each photo change would leave the previous one orphaned.
  // Dynamic import to avoid a cycle: modules/attachments.ts already imports
  // from this file.
  if (oldAvatar && oldAvatar !== p.avatar) {
    import('../modules/attachments.js')
      .then(({ deleteAvatarFile }) => deleteAvatarFile(oldAvatar))
      .catch((err) => console.error(`[${p.id}] falha ao apagar foto de perfil antiga:`, err instanceof Error ? err.stack : err));
  }
}

/** No LiveKit track equivalent for "deafened" — just a flag the client
 * announces so others can show the icon. */
function handleDeafened(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.deafened = !!msg.value;
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
}

// tab closing/reloading: leaves the room immediately, without the reconnect
// grace window (that's only for network drops/crashes, which never fire
// this event).
function handleLeave(socket: AppSocket): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  removeParticipant(p);
}

/** socket.on('disconnect') — opens the reconnect grace window instead of
 * removing immediately, covering network drops/reloads where 'leave' never
 * fires. */
export function handleClose(socket: AppSocket): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return; // already replaced by a newer reconnect
  p.socket = null;
  p.graceTimer = setTimeout(() => removeParticipant(p), config.RECONNECT_GRACE_MS);
}

export const handlers: HandlerTable = {
  profile: handleProfile,
  deafened: handleDeafened,
  leave: handleLeave,
};
