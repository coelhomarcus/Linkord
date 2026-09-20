// Keyset-pagination cursors for the social lists. Pure functions on purpose —
// nothing here touches the DB, so the malformed-input handling (a cursor is
// attacker-controlled text) is testable without one.

/** Server-fixed page size — the client never chooses it (docs/plano-rede-social.md §8.2). */
export const SOCIAL_PAGE_SIZE = 30;

// Timestamps travel as text with MICROsecond precision straight from
// Postgres (`to_char(... 'US')`), never through a JS Date: a Date only holds
// milliseconds, and a keyset comparison against a truncated value silently
// skips rows that fall between the truncated and the real timestamp.
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID_RE = /^[0-9a-f-]{8,64}$/i;

export interface TimeCursor {
  ts: string;
  id: string;
}

export function encodeTimeCursor(ts: string, id: string): string {
  return `${ts}_${id}`;
}

/** null = malformed (callers answer 400, they don't guess). */
export function decodeTimeCursor(raw: string): TimeCursor | null {
  const cut = raw.indexOf('_');
  if (cut < 0) return null;
  const ts = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (!TS_RE.test(ts) || !ID_RE.test(id)) return null;
  return { ts, id };
}

/** Friends are ordered by `lower(username)` — unique and immutable, so the
 * last one returned is a complete cursor by itself. */
const USERNAME_CURSOR_RE = /^[a-z0-9._-]{1,32}$/;

export function decodeUsernameCursor(raw: string): string | null {
  const lower = raw.toLowerCase();
  return USERNAME_CURSOR_RE.test(lower) ? lower : null;
}

/** Escapes `%`, `_` and `\` so user text is matched literally inside a LIKE
 * pattern (Postgres' default escape character is the backslash). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const MAX_SEARCH_LEN = 50;

export function normalizeSearchQuery(raw: unknown): string {
  return String(raw == null ? '' : raw).trim().toLowerCase().slice(0, MAX_SEARCH_LEN);
}
