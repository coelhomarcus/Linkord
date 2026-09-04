import crypto from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { config } from '../../config/env.js';
import type { SessionUser } from '../../types.js';

// Login sessions. The cookie carries a raw 32-byte token; only its sha256
// (`tokenHash`) is stored — a DB leak alone can't be replayed as a session.
//
// The DB is remote, so resolving the session on every Socket.IO handshake/
// HTTP request would be a WAN round-trip per reconnect. Hence a 60s
// in-memory cache — cheap to get wrong in one direction (an avatar change
// or logout from another tab can lag up to 60s), expensive in the other
// (a WAN call on every flaky-network reconnect).

const SESSION_CACHE_TTL_MS = 60 * 1000;
const LAST_SEEN_STALE_MS = 60 * 60 * 1000; // only rewrites lastSeenAt if older than 1h

interface CacheEntry {
  value: SessionUser;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>(); // tokenHash -> { value, expiresAtMs }

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function cacheGet(tokenHash: string): SessionUser | undefined {
  const entry = cache.get(tokenHash);
  if (!entry) return undefined;
  if (entry.expiresAtMs < Date.now()) { cache.delete(tokenHash); return undefined; }
  return entry.value;
}

function cacheSet(tokenHash: string, value: SessionUser): void {
  cache.set(tokenHash, { value, expiresAtMs: Date.now() + SESSION_CACHE_TTL_MS });
}

function cacheInvalidate(tokenHash: string): void {
  cache.delete(tokenHash);
}

/** Creates a new session and returns the RAW token (goes in the cookie) —
 * never persisted in plaintext, only the hash. */
export async function createSession(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash, userId, expiresAt });
  return { rawToken, expiresAt };
}

/** Resolves a raw token (from a cookie) to the session's owner, or null if
 * invalid/expired/nonexistent. */
export async function resolveSession(rawToken: string | undefined | null): Promise<SessionUser | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const cached = cacheGet(tokenHash);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({
      tokenHash: sessions.tokenHash,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      avatar: users.avatar,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    cacheInvalidate(tokenHash);
    return null;
  }

  if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_STALE_MS) {
    // fire-and-forget: a delay/error here shouldn't block resolving the session
    db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.tokenHash, tokenHash)).catch(() => {});
  }

  const value: SessionUser = { tokenHash, userId: row.userId, username: row.username, avatar: row.avatar, role: row.role as SessionUser['role'] };
  cacheSet(tokenHash, value);
  return value;
}

export async function destroySession(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  cacheInvalidate(tokenHash);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Clears expired sessions from the DB — called periodically at boot
 * (src/index.ts), not per request. */
export async function sweepExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Called by modules/moderation.ts when deleting an account — the sessions
 * row is already gone via CASCADE, but this local cache can hold a VALID
 * entry for up to SESSION_CACHE_TTL_MS after that (it only expires by time,
 * doesn't know the DB changed). Without this, someone just deleted would
 * stay authenticated for up to 60s. Scans the whole Map (no index by
 * userId, only tokenHash) — fine since the cache is small and account
 * deletion is rare. */
export function invalidateSessionsForUser(userId: string): void {
  for (const [tokenHash, entry] of cache) {
    if (entry.value && entry.value.userId === userId) cache.delete(tokenHash);
  }
}
