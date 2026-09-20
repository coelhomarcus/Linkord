import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import type { Role } from '../../types.js';

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

/** The minimum needed to render a row in a friends/requests/blocks list —
 * deliberately no banner/bio/links (docs/plano-rede-social.md §5.3: show a
 * minimal result, never a full profile, to someone who isn't authorized to
 * see one yet). */
export interface SocialUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
}

export function toSocialUser(u: User): SocialUser {
  return {
    id: u.id, username: u.username, displayName: resolveDisplayName(u.displayName, u.username),
    avatar: u.avatar, avatarColor: u.avatarColor,
  };
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

/** Every account on the instance — no longer sent to ordinary clients (see
 * realtime/socket.ts's `welcome.knownUsers`, Etapa 7); only
 * `GET /api/admin/users` (usersRoutes.ts) still calls this. */
export async function listAllUsers(): Promise<PublicUser[]> {
  const rows = await db.select().from(users).orderBy(sql`lower(${users.username})`);
  return rows.map(publicUser);
}

/** The "known users" projection sent in `welcome` — bounded to a specific
 * set of ids (friends ∪ conversation members), not everyone. Empty input
 * short-circuits: `inArray` with an empty array is a Drizzle footgun (some
 * versions render invalid SQL), and a brand-new account's known-peer set is
 * legitimately empty. */
export async function listUsersByIds(ids: string[]): Promise<PublicUser[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  return rows.map(publicUser);
}
