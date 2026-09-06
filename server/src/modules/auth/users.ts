import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import type { Role } from '../../types.js';

// Account CRUD. Username uniqueness is case-insensitive (index on
// lower(username) in the schema) — every username lookup must use the
// SAME sql`lower(...)` expression, or Postgres won't use that index.

export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  role: string;
}

export interface UsernameTakenError extends Error {
  code: 'username_taken';
}

export interface AdminAlreadyExistsError extends Error {
  code: 'admin_already_exists';
}

function normalizeCreateError(err: unknown): never {
  // drizzle wraps the driver error in DrizzleQueryError — Postgres's code
  // (23505 = unique_violation) is in err.cause.code, not err.code.
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
  if (cause?.code === '23505') {
    throw Object.assign(new Error('Esse nome de usuario ja esta em uso.'), { code: 'username_taken' as const });
  }
  throw err;
}

export function publicUser(u: User): PublicUser {
  return { id: u.id, username: u.username, avatar: u.avatar, role: u.role };
}

export async function findByUsernameLower(username: string): Promise<User | null> {
  const lower = username.trim().toLowerCase();
  const [row] = await db.select().from(users).where(sql`lower(${users.username}) = ${lower}`).limit(1);
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

/** Throws with `.code = 'username_taken'` if a race loses to the DB's
 * unique index despite the earlier check (e.g. two simultaneous signups
 * with the same name). */
export async function createUser({ username, passwordHash, role }: { username: string; passwordHash: string; role: Role }): Promise<User> {
  const id = crypto.randomUUID();
  try {
    const [row] = await db.insert(users).values({ id, username, passwordHash, role }).returning();
    return row!;
  } catch (err: unknown) {
    normalizeCreateError(err);
  }
}

/** Creates the first administrator under a PostgreSQL advisory lock. The
 * separate bootstrap code is useful only while no admin exists, and the DB
 * lock prevents two concurrent registrations from both winning the check. */
export async function createInitialAdmin({ username, passwordHash }: { username: string; passwordHash: string }): Promise<User> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('linkord-initial-admin'))`);
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
      if (existing) {
        throw Object.assign(new Error('Um administrador ja foi criado.'), { code: 'admin_already_exists' as const });
      }
      const [row] = await tx.insert(users).values({
        id: crypto.randomUUID(),
        username,
        passwordHash,
        role: 'admin',
      }).returning();
      return row!;
    });
  } catch (err: unknown) {
    if ((err as { code?: string } | undefined)?.code === 'admin_already_exists') throw err;
    normalizeCreateError(err);
  }
}

export async function updateAvatar(id: string, avatar: string): Promise<User | null> {
  const [row] = await db.update(users).set({ avatar, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  return row || null;
}
