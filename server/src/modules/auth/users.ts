import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import { config } from '../../config/env.js';
import type { Role } from '../../types.js';

// ---------------------------------------------------------------------------
// CRUD de contas. Unicidade de username e case-insensitive (indice sobre
// lower(username) no schema) — toda busca por username usa a MESMA expressao
// sql`lower(...)`, senao o Postgres nao bate com esse indice.
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  role: string;
}

export interface UsernameTakenError extends Error {
  code: 'username_taken';
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

/** Diretorio de contas (pra sidebar direita, online/offline) — sala privada
 * de baixa escala, ordenar por nome e trazer todo mundo de uma vez e
 * suficiente, sem paginacao. */
export async function listAllUsers(): Promise<PublicUser[]> {
  const rows = await db.select().from(users).orderBy(sql`lower(${users.username})`);
  return rows.map(publicUser);
}

/** Lanca com `.code = 'username_taken'` se a corrida perder a checagem previa
 * pro indice unico do banco (ex.: dois registros simultaneos do mesmo nome). */
export async function createUser({ username, passwordHash, role }: { username: string; passwordHash: string; role: Role }): Promise<User> {
  const id = crypto.randomUUID();
  try {
    const [row] = await db.insert(users).values({ id, username, passwordHash, role }).returning();
    return row!;
  } catch (err: unknown) {
    // drizzle envolve o erro do driver em DrizzleQueryError — o codigo do
    // Postgres (23505 = unique_violation) vem em err.cause.code, nao err.code.
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23505') {
      const dup = Object.assign(new Error('Esse nome de usuario ja esta em uso.'), { code: 'username_taken' as const });
      throw dup;
    }
    throw err;
  }
}

export async function updateAvatar(id: string, avatar: string): Promise<User | null> {
  const [row] = await db.update(users).set({ avatar, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  return row || null;
}

export function isAdminUsername(username: string): boolean {
  return username.trim().toLowerCase() === config.ADMIN_USERNAME.trim().toLowerCase();
}
