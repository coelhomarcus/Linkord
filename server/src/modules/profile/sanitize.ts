import { config } from '../../config/env.js';

// external URL (https://...) or one of our own uploads (/uploads/<id>)
const UPLOADED_AVATAR_RE = /^\/uploads\/[0-9a-f]{32}$/;
// exported for modules/conversations.ts — a group avatar is validated the
// exact same way an account's is, just stored on `conversations` instead.
export function sanitizeAvatar(url: unknown): string {
  const s = String(url == null ? '' : url).trim().slice(0, config.MAX_AVATAR_LEN);
  return /^https?:\/\/\S+$/i.test(s) || UPLOADED_AVATAR_RE.test(s) ? s : '';
}

export function sanitizeBanner(url: unknown): string {
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
export function sanitizeAvatarColor(value: unknown): string {
  const key = String(value == null ? '' : value).trim().slice(0, 32);
  if (AVATAR_COLOR_VALUES.has(key)) return key;
  return HEX_COLOR_RE.test(key) ? key.toLowerCase() : DEFAULT_AVATAR_COLOR;
}

// free-form (no allowed-values set, unlike avatarColor) — just trimmed,
// collapsed to single-line, and length-capped. Falling back to the
// username when this comes out empty is the CALLER's job (join/
// handleProfile), since only they know the account's username here.
export function sanitizeDisplayName(value: unknown): string {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, config.MAX_DISPLAY_NAME_LEN);
}

export function sanitizeBio(value: unknown): string {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, config.MAX_PROFILE_BIO_LEN);
}

export function sanitizeProfileLinks(value: unknown): string[] {
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
