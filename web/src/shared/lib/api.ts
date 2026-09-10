
import type { ChatAttachment } from '../../types/protocol';
import type { DetectedEmbed } from './chatEmbeds';

export interface ApiUser {
  id: string;
  username: string;
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
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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

export function register(username: string, password: string, confirmPassword: string, code: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password, confirmPassword, code }) });
}

export function logout(): Promise<void> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export type MediaKind = 'uploads' | 'embeds';

export interface MediaItem {
  msgId: number;
  channelId: string;
  channelName: string;
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
