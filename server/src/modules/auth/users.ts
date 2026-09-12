import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import { config } from '../../config/env.js';
import type { Role } from '../../types.js';
import { invalidateSessionsForUser } from './session.js';

// Account CRUD. Username uniqueness is case-insensitive (index on
// lower(username) in the schema) — every username lookup must use the
// SAME sql`lower(...)` expression, or Postgres won't use that index.

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: Role;
}

export interface PrivateUser extends PublicUser {
  email: string | null;
}

export interface AccountIdentityTakenError extends Error {
  code: 'account_identity_taken';
}

/** '' (never set, or explicitly cleared) falls back to the immutable
 * username — every read of a user's displayName goes through this, so a
 * legacy row (from before this column existed) never surfaces as blank. */
export function resolveDisplayName(displayName: string, username: string): string {
  return displayName.trim() || username;
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id, username: u.username, displayName: resolveDisplayName(u.displayName, u.username),
    avatar: u.avatar, avatarColor: u.avatarColor, banner: u.banner, bio: u.bio,
    profileLinks: Array.isArray(u.profileLinks) ? u.profileLinks : [],
    role: u.role as Role,
  };
}

export function privateUser(u: User): PrivateUser {
  return { ...publicUser(u), email: u.email };
}

export async function findByUsernameLower(username: string): Promise<User | null> {
  const lower = username.trim().toLowerCase();
  const [row] = await db.select().from(users).where(sql`lower(${users.username}) = ${lower}`).limit(1);
  return row || null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function findByEmailLower(email: string): Promise<User | null> {
  const lower = normalizeEmail(email);
  const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${lower}`).limit(1);
  return row || null;
}

export async function findById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row || null;
}

/** Account directory (right sidebar, online/offline) — small private
 * room, sorting by name and fetching everyone at once is enough, no
 * pagination. */
export async function listAllUsers(): Promise<PublicUser[]> {
  const rows = await db.select().from(users).orderBy(sql`lower(${users.username})`);
  return rows.map(publicUser);
}

/** Throws with `.code = 'account_identity_taken'` if a race loses to either
 * identity unique index despite the earlier checks. */
export async function createUser({ username, email, passwordHash, role }: { username: string; email: string; passwordHash: string; role: Role }): Promise<User> {
  const id = crypto.randomUUID();
  try {
    const [row] = await db.insert(users).values({ id, username, email: normalizeEmail(email), passwordHash, role }).returning();
    return row!;
  } catch (err: unknown) {
    // drizzle wraps the driver error in DrizzleQueryError — Postgres's code
    // (23505 = unique_violation) is in err.cause.code, not err.code.
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23505') {
      const dup = Object.assign(new Error('Esse nome de usuário ou e-mail já está em uso.'), { code: 'account_identity_taken' as const });
      throw dup;
    }
    throw err;
  }
}

export async function updateEmail(id: string, email: string): Promise<User | null> {
  try {
    const [row] = await db.update(users)
      .set({ email: normalizeEmail(email), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    invalidateSessionsForUser(id);
    return row || null;
  } catch (err: unknown) {
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23505') {
      throw Object.assign(new Error('Esse e-mail já está em uso.'), { code: 'email_taken' as const });
    }
    throw err;
  }
}

export async function updatePassword(id: string, passwordHash: string): Promise<User | null> {
  const [row] = await db.update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return row || null;
}

export async function updateProfile(id: string, profile: { avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set({
      avatar: profile.avatar,
      avatarColor: profile.avatarColor,
      displayName: profile.displayName,
      banner: profile.banner,
      bio: profile.bio,
      profileLinks: profile.profileLinks,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  invalidateSessionsForUser(id);
  return row || null;
}

export async function updateAvatar(id: string, avatar: string): Promise<User | null> {
  const [row] = await db.update(users).set({ avatar, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  invalidateSessionsForUser(id);
  return row || null;
}

export function isAdminUsername(username: string): boolean {
  return username.trim().toLowerCase() === config.ADMIN_USERNAME.trim().toLowerCase();
}
