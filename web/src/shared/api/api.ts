
import type { ChatAttachment, InvitationCard, PublicUser } from '@/shared/types/protocol';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';

export interface ApiUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  avatar: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
}

export class ApiError extends Error {
  status: number;
  code: string;
  // only the friend-request cooldown response carries this
  retryAfter?: string;
  constructor(status: number, code: string, message: string, retryAfter?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    // Only when there IS a body — Fastify's default JSON parser 400s a
    // request that declares Content-Type: application/json but sends an
    // empty body (e.g. POST /api/auth/logout), which used to fail silently
    // (swallowed by AuthContext's logout() try/catch) and leave the real
    // session cookie alive on the server after a client-side "logout".
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
  });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try { body = await res.json(); } catch {  }

  if (!res.ok) {
    const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string; retryAfter?: string } }).error : null) || {};
    throw new ApiError(res.status, err.code || 'unknown_error', err.message || 'Erro inesperado.', err.retryAfter);
  }
  return body as T;
}

export function fetchMe(): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/me');
}

export function login(username: string, password: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function register(username: string, email: string, password: string, confirmPassword: string, code: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, confirmPassword, code }) });
}

export type RecoveryIdentifier = { type: 'email'; value: string } | { type: 'username'; value: string };

function identifierPayload(identifier: RecoveryIdentifier): { email: string } | { username: string } {
  return identifier.type === 'email' ? { email: identifier.value } : { username: identifier.value };
}

export function requestPasswordRecovery(identifier: RecoveryIdentifier): Promise<{ ok: true }> {
  return apiFetch('/api/auth/recovery/request', { method: 'POST', body: JSON.stringify(identifierPayload(identifier)) });
}

export function resetPassword(identifier: RecoveryIdentifier, code: string, password: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/recovery/reset', { method: 'POST', body: JSON.stringify({ ...identifierPayload(identifier), code, password }) });
}

export function linkEmail(email: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/email/link', { method: 'POST', body: JSON.stringify({ email }) });
}

export function requestEmailChange(email: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/email/change/request', { method: 'POST', body: JSON.stringify({ email }) });
}

export function confirmEmailChange(email: string, code: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/email/change/confirm', { method: 'POST', body: JSON.stringify({ email, code }) });
}

export function logout(): Promise<void> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export type MediaKind = 'uploads' | 'embeds';

export interface MediaItem {
  msgId: number;
  conversationId: string;
  conversationName: string;
  authorId: string | null;
  authorName: string;
  authorAvatar: string;
  authorAvatarColor: string;
  ts: number;
  attachment?: ChatAttachment;
  embed?: DetectedEmbed;
}

export interface MediaPage {
  items: MediaItem[];
  nextBefore: number | null;
}

export function fetchMedia(kind: MediaKind, before: number | null, conversationId: string, limit = 24): Promise<MediaPage> {
  const params = new URLSearchParams({ kind, limit: String(limit), conversationId });
  if (before != null) params.set('before', String(before));
  return apiFetch(`/api/media?${params.toString()}`);
}

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  video: string | null;
  favicon: string | null;
  siteName: string;
  themeColor: string | null;
}

export function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  return apiFetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
}

/** On-demand profile fetch (Etapa 7) — for when a profile isn't already in
 * the known-users cache (usePresence.ts's `allUsers`), e.g. the author of
 * an old message who has since left the conversation. 404 covers both
 * "doesn't exist" and "not authorized to view" — same posture as the rest
 * of the social endpoints, never confirms/denies a relationship. */
export function fetchUserProfile(userId: string): Promise<{ user: PublicUser }> {
  return apiFetch(`/api/users/${userId}/profile`);
}

export interface AdminUserRow extends PublicUser { online: boolean }

/** Admin-only, minimal stopgap for ModerationTab — the socket welcome no
 * longer ships a global directory, so the "list every account to delete
 * one" admin view needs its own fetch now. */
export function fetchAdminUsers(): Promise<{ users: AdminUserRow[] }> {
  return apiFetch('/api/admin/users');
}

// ---- social: friends, requests, blocks (Etapa 8) ----------------------------

/** The minimum a friends/requests/blocks row needs — no banner/bio, the
 * server never sends a full profile to someone not yet authorized to see one. */
export interface SocialUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
}

export interface SocialEntry { user: SocialUser; at: string }
export interface SocialPage { items: SocialEntry[]; nextCursor: string | null }

export type Relation = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked';
export interface Relationship { relation: Relation; retryAfter: string | null }

function pageQuery(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const text = q.toString();
  return text ? `?${text}` : '';
}

export function fetchFriends(cursor: string | null, q: string): Promise<SocialPage> {
  return apiFetch(`/api/friends${pageQuery({ cursor, q })}`);
}

export function fetchFriendRequests(direction: 'incoming' | 'outgoing', cursor: string | null): Promise<SocialPage> {
  return apiFetch(`/api/friend-requests${pageQuery({ direction, cursor })}`);
}

export function fetchRequestSummary(): Promise<{ incoming: number; invitations: number }> {
  return apiFetch('/api/friend-requests/summary');
}

export function fetchBlocks(cursor: string | null): Promise<SocialPage> {
  return apiFetch(`/api/blocks${pageQuery({ cursor })}`);
}

export function fetchRelationship(userId: string): Promise<Relationship> {
  return apiFetch(`/api/relationships/${encodeURIComponent(userId)}`);
}

export type FriendRequestOutcome = 'created' | 'already_friends' | 'already_pending' | 'pending_received';

interface FriendRequestResponse { friendship: { status: string }; direction?: 'outgoing' | 'incoming' }

/** Sends a request by exact username. The server answers 201/200 with the
 * same body shape, so the outcome is derived from the body — `direction` says
 * a request was already pending (either way), an accepted status says the two
 * are already friends, anything else is a fresh request. */
export async function sendFriendRequest(username: string): Promise<FriendRequestOutcome> {
  const res = await apiFetch<FriendRequestResponse>('/api/friend-requests', { method: 'POST', body: JSON.stringify({ username }) });
  if (res.direction === 'incoming') return 'pending_received';
  if (res.direction === 'outgoing') return 'already_pending';
  return res.friendship.status === 'accepted' ? 'already_friends' : 'created';
}

export function acceptFriendRequest(userId: string): Promise<unknown> {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(userId)}/accept`, { method: 'POST' });
}

export function declineFriendRequest(userId: string): Promise<unknown> {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(userId)}/decline`, { method: 'POST' });
}

export function cancelFriendRequest(userId: string): Promise<unknown> {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(userId)}/cancel`, { method: 'POST' });
}

export function removeFriend(userId: string): Promise<unknown> {
  return apiFetch(`/api/friendships/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function blockUser(userId: string): Promise<unknown> {
  return apiFetch(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'POST' });
}

export function unblockUser(userId: string): Promise<unknown> {
  return apiFetch(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

// ---- group invitations (Etapa 9) --------------------------------------------

export type InviteOutcome = 'sent' | 'already_pending' | 'already_member' | 'not_friends' | 'cooldown' | 'group_full' | 'unavailable';
export interface InviteResult { userId: string; outcome: InviteOutcome; invitationId?: string; retryAfter?: string }

export interface ReceivedInvitationEntry {
  id: string;
  at: string;
  expiresAt: number;
  group: { id: string; title: string; avatar: string; memberCount: number };
  inviter: SocialUser;
}
export interface SentInvitationEntry { id: string; at: string; expiresAt: number; invitee: SocialUser }

export function createGroup(title: string, inviteeIds: string[]): Promise<{ conversationId: string; results: InviteResult[] }> {
  return apiFetch('/api/groups', { method: 'POST', body: JSON.stringify({ title, inviteeIds }) });
}

export function inviteToGroup(conversationId: string, userIds: string[]): Promise<{ results: InviteResult[] }> {
  return apiFetch(`/api/groups/${encodeURIComponent(conversationId)}/invitations`, { method: 'POST', body: JSON.stringify({ userIds }) });
}

export function fetchGroupInvitations(conversationId: string, cursor: string | null): Promise<{ items: SentInvitationEntry[]; nextCursor: string | null }> {
  return apiFetch(`/api/groups/${encodeURIComponent(conversationId)}/invitations${pageQuery({ cursor })}`);
}

export function fetchReceivedInvitations(cursor: string | null): Promise<{ items: ReceivedInvitationEntry[]; nextCursor: string | null }> {
  return apiFetch(`/api/group-invitations${pageQuery({ cursor })}`);
}

export function acceptInvitation(id: string): Promise<{ invitation: InvitationCard }> {
  return apiFetch(`/api/group-invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

export function declineInvitation(id: string): Promise<{ invitation: InvitationCard }> {
  return apiFetch(`/api/group-invitations/${encodeURIComponent(id)}/decline`, { method: 'POST' });
}

export function revokeInvitation(id: string): Promise<{ invitation: InvitationCard }> {
  return apiFetch(`/api/group-invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
