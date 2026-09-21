import crypto from 'node:crypto';
import { config } from '../../config/env.js';
import { updateProfile } from '../profile/profileRepository.js';
import { sanitizeAvatar, sanitizeBanner, sanitizeAvatarColor, sanitizeDisplayName, sanitizeBio, sanitizeProfileLinks } from '../profile/sanitize.js';
import { deleteAvatarFile } from '../attachments/attachmentCleanup.js';
import type { AppSocket, HandlerTable, Participant, PublicParticipant } from '../../types.js';

// Presence for the single shared room. `id` is per-CONNECTION (used as the
// LiveKit identity) — if it were per-account, a second tab would get the
// same identity and LiveKit would kick the first one. `userId` (the
// account) is what ties reconnection together and lets two tabs coexist.
export const participants = new Map<string, Participant>(); // id -> participant

const newId = () => crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

export function publicParticipant(p: Participant): PublicParticipant {
  return {
    id: p.id, userId: p.userId, name: p.name, displayName: p.displayName,
    avatar: p.avatar, avatarPoster: p.avatarPoster, avatarColor: p.avatarColor,
    banner: p.banner, bannerPoster: p.bannerPoster, bio: p.bio, profileLinks: p.profileLinks, role: p.role,
    deafened: p.deafened, callConversationId: p.callConversationId,
    micActivated: p.micActivated, micMuted: p.micMuted, cameraOn: p.cameraOn, sharing: p.sharing, speaking: p.speaking,
  };
}

/** Changes which conversation's call `p` is in (or none, with null) and
 * notifies everyone. Also resets self-reported media flags: a fresh join/leave
 * means previous call state no longer applies. */
export function setCallConversationId(p: Participant, conversationId: string | null): void {
  p.callConversationId = conversationId;
  p.micActivated = false;
  p.micMuted = true;
  p.cameraOn = false;
  p.sharing = false;
  p.speaking = false;
  broadcastToKnownPeers(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
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

/** Scoped presence broadcast (Etapa 7) — delivers to whoever has
 * `subjectUserId` in their OWN `knownPeerIds` (computed at THEIR join
 * time, see realtime/socket.ts), plus always to the subject's own other
 * tabs/devices (multi-tab profile/mic-state sync). Checking the
 * RECEIVER's cached set (not the subject's) is what makes this work even
 * when the subject has no live connection at all — e.g. notifying a
 * friend that an account got deleted. */
export function broadcastToKnownPeers(subjectUserId: string, obj: { t: string; [key: string]: unknown }, exceptId?: string): void {
  for (const p of participants.values()) {
    if (p.id === exceptId) continue;
    if (p.userId !== subjectUserId && (!p.knownPeerIds.has(subjectUserId) || p.blockedPeerIds.has(subjectUserId))) continue;
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
  broadcastToKnownPeers(p.userId, { t: 'participant-left', id: p.id });
  // only here (not handleClose) to respect the same grace window as
  // 'participant-left' — a brief network drop shouldn't flicker offline.
  if (!isUserOnline(p.userId)) broadcastToKnownPeers(p.userId, { t: 'user-offline', userId: p.userId });
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
export function join(socket: AppSocket, msg: JoinMessage): { participant: Participant; justCameOnline: boolean } | null {
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
      avatarPoster: sanitizeAvatar(u.avatarPoster),
      avatarColor: sanitizeAvatarColor(u.avatarColor),
      banner: sanitizeBanner(u.banner),
      bannerPoster: sanitizeBanner(u.bannerPoster),
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
      knownPeerIds: new Set(),
      blockedPeerIds: new Set(),
    };
    participants.set(p.id, p);
  }
  socket.participantId = p.id;
  // caller (handleJoin, realtime/socket.ts) computes p.knownPeerIds and
  // broadcasts 'user-online' itself — that field doesn't exist yet here.
  return { participant: p, justCameOnline: !wasOnline };
}

/** Avatar, avatar background color, and displayName are all editable —
 * `name` stays the account's immutable username (used for @mentions/login,
 * never shown as-is once displayName exists). An empty/whitespace-only
 * displayName resets back to the username, same idea as avatarColor
 * falling back to the default on an invalid value. Persisted to survive
 * reconnects/other tabs. */
function handleProfile(socket: AppSocket, msg: { avatar?: string; avatarPoster?: string; avatarColor?: string; displayName?: string; banner?: string; bannerPoster?: string; bio?: string; profileLinks?: string[] } | null | undefined): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const body = msg && typeof msg === 'object' ? msg : {};
  const oldAvatar = p.avatar;
  const oldAvatarPoster = p.avatarPoster;
  const nextAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar')
    ? sanitizeAvatar(body.avatar)
    : p.avatar;
  const nextAvatarPoster = Object.prototype.hasOwnProperty.call(body, 'avatarPoster')
    ? sanitizeAvatar(body.avatarPoster)
    : p.avatarPoster;
  const nextAvatarColor = Object.prototype.hasOwnProperty.call(body, 'avatarColor')
    ? sanitizeAvatarColor(body.avatarColor)
    : p.avatarColor;
  const nextDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName')
    ? (sanitizeDisplayName(body.displayName) || p.name)
    : p.displayName;
  const nextBanner = Object.prototype.hasOwnProperty.call(body, 'banner')
    ? sanitizeBanner(body.banner)
    : p.banner;
  const nextBannerPoster = Object.prototype.hasOwnProperty.call(body, 'bannerPoster')
    ? sanitizeBanner(body.bannerPoster)
    : p.bannerPoster;
  const nextBio = Object.prototype.hasOwnProperty.call(body, 'bio')
    ? sanitizeBio(body.bio)
    : p.bio;
  const nextProfileLinks = Object.prototype.hasOwnProperty.call(body, 'profileLinks')
    ? sanitizeProfileLinks(body.profileLinks)
    : p.profileLinks;
  for (const other of participants.values()) {
    if (other.userId !== p.userId) continue;
    other.avatar = nextAvatar;
    other.avatarPoster = nextAvatarPoster;
    other.avatarColor = nextAvatarColor;
    other.displayName = nextDisplayName;
    other.banner = nextBanner;
    other.bannerPoster = nextBannerPoster;
    other.bio = nextBio;
    other.profileLinks = nextProfileLinks;
    broadcastToKnownPeers(other.userId, { t: 'participant-updated', participant: publicParticipant(other) });
  }
  updateProfile(p.userId, {
    avatar: nextAvatar,
    avatarPoster: nextAvatarPoster,
    avatarColor: nextAvatarColor,
    displayName: nextDisplayName,
    banner: nextBanner,
    bannerPoster: nextBannerPoster,
    bio: nextBio,
    profileLinks: nextProfileLinks,
  })
    .catch((err) => console.error(`[${p.id}] failed to save profile:`, err instanceof Error ? err.stack : err));
  // deletes the OLD photo file(s) if they were one of our uploads and
  // changed — otherwise each photo change would leave the previous one(s)
  // orphaned.
  if (oldAvatar && oldAvatar !== p.avatar) {
    deleteAvatarFile(oldAvatar).catch((err) => console.error(`[${p.id}] failed to delete old profile photo:`, err instanceof Error ? err.stack : err));
  }
  if (oldAvatarPoster && oldAvatarPoster !== p.avatarPoster) {
    deleteAvatarFile(oldAvatarPoster).catch((err) => console.error(`[${p.id}] failed to delete old profile photo:`, err instanceof Error ? err.stack : err));
  }
}

/** No LiveKit track equivalent for "deafened" — just a flag the client
 * announces so others can show the icon. */
function handleDeafened(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.deafened = !!msg.value;
  broadcastToKnownPeers(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
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
  broadcastToKnownPeers(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
}

function handleCamera(socket: AppSocket, msg: { on?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.cameraOn = !!msg.on;
  broadcastToKnownPeers(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
}

function handleScreenShare(socket: AppSocket, msg: { on?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.sharing = !!msg.on;
  broadcastToKnownPeers(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
}

/** Detected 100% client-side (real audio level via Web Audio, see
 * useLiveKitTrack.ts#useTrackSpeaking) — this just relays the already
 * debounced on/off transitions, not a continuous stream. */
function handleSpeaking(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.speaking = !!msg.value;
  broadcastToKnownPeers(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
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
