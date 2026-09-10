import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { updateProfile } from '../modules/auth/users.js';
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

function sanitizeBanner(url: unknown): string {
  const s = String(url == null ? '' : url).trim().slice(0, config.MAX_BANNER_LEN);
  return /^https?:\/\/\S+$/i.test(s) || UPLOADED_AVATAR_RE.test(s) ? s : '';
}

const DEFAULT_AVATAR_COLOR = 'blurple';
// preset keys — kept in sync with web/src/shared/Avatar.tsx#AVATAR_COLOR_OPTIONS
// (no shared package between server/web, see that file's comment).
const AVATAR_COLOR_VALUES = new Set([DEFAULT_AVATAR_COLOR, 'green', 'red', 'fuchsia', 'orange', 'purple', 'teal', 'blue']);
// beyond the presets, the color picker (Settings > Perfil) lets someone save
// ANY color as a plain 6-digit hex.
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
function sanitizeAvatarColor(value: unknown): string {
  const key = String(value == null ? '' : value).trim().slice(0, 32);
  if (AVATAR_COLOR_VALUES.has(key)) return key;
  return HEX_COLOR_RE.test(key) ? key.toLowerCase() : DEFAULT_AVATAR_COLOR;
}

// free-form (no allowed-values set, unlike avatarColor) — just trimmed,
// collapsed to single-line, and length-capped. Falling back to the
// username when this comes out empty is the CALLER's job (join/
// handleProfile), since only they know the account's username here.
function sanitizeDisplayName(value: unknown): string {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, config.MAX_DISPLAY_NAME_LEN);
}

function sanitizeBio(value: unknown): string {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, config.MAX_PROFILE_BIO_LEN);
}

function sanitizeProfileLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = String(item == null ? '' : item).trim().slice(0, config.MAX_PROFILE_LINK_LEN);
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url);
    if (links.length >= config.MAX_PROFILE_LINKS) break;
  }
  return links;
}

export function publicParticipant(p: Participant): PublicParticipant {
  return {
    id: p.id, userId: p.userId, name: p.name, displayName: p.displayName,
    avatar: p.avatar, avatarColor: p.avatarColor, banner: p.banner, bio: p.bio, profileLinks: p.profileLinks, role: p.role,
    deafened: p.deafened, callConversationId: p.callConversationId,
    micActivated: p.micActivated, micMuted: p.micMuted, cameraOn: p.cameraOn, sharing: p.sharing, speaking: p.speaking,
  };
}

/** Changes which group conversation call `p` is in (or none, with null) and
 * notifies everyone. Also resets self-reported media flags: a fresh join/leave
 * means previous call state no longer applies. */
export function setCallConversationId(p: Participant, conversationId: string | null): void {
  p.callConversationId = conversationId;
  p.micActivated = false;
  p.micMuted = true;
  p.cameraOn = false;
  p.sharing = false;
  p.speaking = false;
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
      // u.displayName (SessionUser) already resolved a non-empty value in
      // session.ts — sanitizeDisplayName here is just defense in depth
      // (same pattern as sanitizeAvatar/sanitizeAvatarColor above).
      displayName: sanitizeDisplayName(u.displayName) || u.username,
      avatar: sanitizeAvatar(u.avatar),
      avatarColor: sanitizeAvatarColor(u.avatarColor),
      banner: sanitizeBanner(u.banner),
      bio: sanitizeBio(u.bio),
      profileLinks: sanitizeProfileLinks(u.profileLinks),
      role: u.role,
      // always starts undeafened on a brand NEW connection (client starts
      // the same way); a resume above reuses the existing `p` and
      // PRESERVES the value.
      deafened: false,
      callConversationId: null,
      micActivated: false,
      micMuted: true,
      cameraOn: false,
      sharing: false,
      speaking: false,
      graceTimer: null,
    };
    participants.set(p.id, p);
  }
  socket.participantId = p.id;
  if (!wasOnline) broadcast({ t: 'user-online', userId: u.userId });
  return p;
}

/** Avatar, avatar background color, and displayName are all editable —
 * `name` stays the account's immutable username (used for @mentions/login,
 * never shown as-is once displayName exists). An empty/whitespace-only
 * displayName resets back to the username, same idea as avatarColor
 * falling back to the default on an invalid value. Persisted to survive
 * reconnects/other tabs. */
function handleProfile(socket: AppSocket, msg: { avatar?: string; avatarColor?: string; displayName?: string; banner?: string; bio?: string; profileLinks?: string[] } | null | undefined): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const body = msg && typeof msg === 'object' ? msg : {};
  const oldAvatar = p.avatar;
  const nextAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar')
    ? sanitizeAvatar(body.avatar)
    : p.avatar;
  const nextAvatarColor = Object.prototype.hasOwnProperty.call(body, 'avatarColor')
    ? sanitizeAvatarColor(body.avatarColor)
    : p.avatarColor;
  const nextDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName')
    ? (sanitizeDisplayName(body.displayName) || p.name)
    : p.displayName;
  const nextBanner = Object.prototype.hasOwnProperty.call(body, 'banner')
    ? sanitizeBanner(body.banner)
    : p.banner;
  const nextBio = Object.prototype.hasOwnProperty.call(body, 'bio')
    ? sanitizeBio(body.bio)
    : p.bio;
  const nextProfileLinks = Object.prototype.hasOwnProperty.call(body, 'profileLinks')
    ? sanitizeProfileLinks(body.profileLinks)
    : p.profileLinks;
  for (const other of participants.values()) {
    if (other.userId !== p.userId) continue;
    other.avatar = nextAvatar;
    other.avatarColor = nextAvatarColor;
    other.displayName = nextDisplayName;
    other.banner = nextBanner;
    other.bio = nextBio;
    other.profileLinks = nextProfileLinks;
    broadcast({ t: 'participant-updated', participant: publicParticipant(other) });
  }
  updateProfile(p.userId, {
    avatar: nextAvatar,
    avatarColor: nextAvatarColor,
    displayName: nextDisplayName,
    banner: nextBanner,
    bio: nextBio,
    profileLinks: nextProfileLinks,
  })
    .catch((err) => console.error(`[${p.id}] falha ao salvar perfil:`, err instanceof Error ? err.stack : err));
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

/** Self-reported mic state (see ClientMessage 'mic-state') — the server
 * never verifies this against LiveKit, same trust model as `deafened`.
 * Lets anyone see an accurate mic-muted icon for this participant, not
 * just people connected to the same LiveKit room. */
function handleMicState(socket: AppSocket, msg: { activated?: unknown; muted?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.micActivated = !!msg.activated;
  p.micMuted = !!msg.muted;
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
}

function handleCamera(socket: AppSocket, msg: { on?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.cameraOn = !!msg.on;
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
}

function handleScreenShare(socket: AppSocket, msg: { on?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.sharing = !!msg.on;
  broadcast({ t: 'participant-updated', participant: publicParticipant(p) });
}

/** Detected 100% client-side (real audio level via Web Audio, see
 * useLiveKitTrack.ts#useTrackSpeaking) — this just relays the already
 * debounced on/off transitions, not a continuous stream. */
function handleSpeaking(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.speaking = !!msg.value;
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
  'mic-state': handleMicState,
  camera: handleCamera,
  'screen-share': handleScreenShare,
  speaking: handleSpeaking,
  leave: handleLeave,
};
