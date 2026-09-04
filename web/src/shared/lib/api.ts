/** Thin HTTP client for the routes outside the WebSocket — the rest of the
 * app speaks Socket.IO; this covers what must exist BEFORE any socket
 * (login/register, since the handshake requires a session cookie) and
 * what's simpler as plain REST (Settings' Media tab, see
 * server/src/modules/media.ts — a paginated listing, no state to keep
 * alive in a socket). */

import type { ChatAttachment } from '../../types/protocol';
import type { DetectedEmbed } from './chatEmbeds';

export interface ApiUser {
  id: string;
  username: string;
  avatar: string;
  role: 'user' | 'admin';
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty/non-JSON body — handled below */ }

  if (!res.ok) {
    const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null) || {};
    throw new ApiError(res.status, err.code || 'unknown_error', err.message || 'Erro inesperado.');
  }
  return body as T;
}

export function fetchMe(): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/me');
}

export function login(username: string, password: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function register(username: string, password: string, confirmPassword: string, code: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password, confirmPassword, code }) });
}

export function logout(): Promise<void> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export type MediaKind = 'uploads' | 'embeds';

/** An entry in the Media tab — always has EITHER `attachment` (kind=uploads)
 * OR `embed` (kind=embeds), never both, never neither (see media.ts). */
export interface MediaItem {
  msgId: number;
  channelId: string;
  channelName: string;
  authorName: string;
  authorAvatar: string;
  ts: number;
  attachment?: ChatAttachment;
  embed?: DetectedEmbed;
}

export interface MediaPage {
  items: MediaItem[];
  /** `msgId` to send as `before` on the next call — null once it reaches
   * the end (see media.ts#fetchUploadsPage/fetchEmbedsPage). */
  nextBefore: number | null;
}

export function fetchMedia(kind: MediaKind, before: number | null, limit = 24): Promise<MediaPage> {
  const params = new URLSearchParams({ kind, limit: String(limit) });
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
