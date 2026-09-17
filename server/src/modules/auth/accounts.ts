import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import { config } from '../../config/env.js';
import type { Role } from '../../types.js';
import { invalidateSessionsForUser } from './session.js';
import { normalizeEmail } from '../users/users.js';

// Account lifecycle: create/register, and change the two credential fields
// (email, password). `modules/users/users.ts` owns looking a user up and
// shaping it for a response — this file owns mutating the account itself.

// Not read anywhere — createUser's throw does a plain duck-type check
// (`err.code === 'account_identity_taken'`) instead of importing this.
// Kept alongside createUser since that's the only place the shape matters.
export interface AccountIdentityTakenError extends Error {
  code: 'account_identity_taken';
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

export function isAdminUsername(username: string): boolean {
  return username.trim().toLowerCase() === config.ADMIN_USERNAME.trim().toLowerCase();
}
