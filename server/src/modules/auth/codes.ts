import crypto from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { authCodes } from '../../db/schema.js';
import { config } from '../../config/env.js';
import { normalizeEmail } from './users.js';

export type AuthCodePurpose = 'password_reset' | 'email_change';

export type VerifyCodeResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'invalid_code' | 'code_expired' | 'too_many_attempts' };

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function codeMatches(code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashCode(code));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function issueAuthCode(userId: string, purpose: AuthCodePurpose, email: string): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  await db.update(authCodes)
    .set({ consumedAt: now })
    .where(and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose), isNull(authCodes.consumedAt)));

  const code = String(crypto.randomInt(100000, 1000000));
  await db.insert(authCodes).values({
    id: crypto.randomUUID(),
    userId,
    purpose,
    email: normalizedEmail,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + config.AUTH_CODE_TTL_MS),
  });
  return code;
}

export async function verifyAuthCode(
  userId: string,
  purpose: AuthCodePurpose,
  email: string,
  code: string,
): Promise<VerifyCodeResult> {
  const normalizedEmail = normalizeEmail(email);
  const [record] = await db.select().from(authCodes)
    .where(and(
      eq(authCodes.userId, userId),
      eq(authCodes.purpose, purpose),
      eq(authCodes.email, normalizedEmail),
      isNull(authCodes.consumedAt),
    ))
    .orderBy(desc(authCodes.createdAt))
    .limit(1);

  if (!record) return { ok: false, reason: 'invalid_code' };
  if (record.expiresAt.getTime() <= Date.now()) {
    await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
    return { ok: false, reason: 'code_expired' };
  }
  if (record.attempts >= config.AUTH_CODE_MAX_ATTEMPTS) {
    await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
    return { ok: false, reason: 'too_many_attempts' };
  }

  await db.update(authCodes).set({ attempts: record.attempts + 1 }).where(eq(authCodes.id, record.id));
  if (!codeMatches(code, record.codeHash)) {
    if (record.attempts + 1 >= config.AUTH_CODE_MAX_ATTEMPTS) {
      await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'invalid_code' };
  }

  await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
  return { ok: true, id: record.id };
}
