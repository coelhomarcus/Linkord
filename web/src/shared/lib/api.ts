
import type { ChatAttachment } from '../../types/protocol';
import type { DetectedEmbed } from './chatEmbeds';

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

export function register(username: string, email: string, password: string, confirmPassword: string, code: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, confirmPassword, code }) });
}

export function requestPasswordRecovery(email: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/recovery/request', { method: 'POST', body: JSON.stringify({ email }) });
}

export function resetPassword(email: string, code: string, password: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/recovery/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) });
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
