import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies, serializeCookie, clearCookie, isSecureRequest } from '../../http/cookies.js';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH } from './password.js';
import { createSession, resolveSession, destroySession } from './session.js';
import { findByUsernameLower, createInitialAdmin, createUser, publicUser } from './users.js';
import { broadcast, disconnectSession } from '../../realtime/participants.js';
import * as ratelimit from './ratelimit.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

// /api/auth/* routes — registration closed behind an invite code, login,
// logout, and "who am I" (used by the frontend at boot to check if
// already logged in).

const USERNAME_RE = new RegExp(`^[A-Za-z0-9_.-]{${config.MIN_USERNAME_LEN},${config.MAX_USERNAME_LEN}}$`);

function ipOfRequest(request: FastifyRequest): string {
  if (config.TRUST_PROXY) {
    const fwd = request.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  }
  return request.raw.socket.remoteAddress || '?';
}

/** Constant-time compare even when lengths differ — timingSafeEqual throws
 * in that case, so we still spend an equal-length compare to avoid leaking
 * the correct code's length via timing. */
function safeCompare(a: unknown, b: unknown): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, rawToken: string): void {
  const cookie = serializeCookie(config.SESSION_COOKIE, rawToken, {
    maxAgeSec: config.SESSION_TTL_DAYS * 24 * 60 * 60,
    secure: isSecureRequest(request.raw),
  });
  reply.header('Set-Cookie', cookie);
}

async function handleRegister(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const attemptKey = `register:${ipOfRequest(request)}`;
  const blockedSec = ratelimit.checkBlocked(attemptKey);
  if (blockedSec) {
    reply.header('Retry-After', String(blockedSec));
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }
  // Registration hashes a password and writes to the database, so cap all
  // attempts (not just wrong invite codes) per IP within the limiter window.
  ratelimit.recordFailure(attemptKey);

  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  const password = String(body.password == null ? '' : body.password);
  const confirmPassword = String(body.confirmPassword == null ? '' : body.confirmPassword);
  const code = String(body.code == null ? '' : body.code);

  // A separate bootstrap code creates the first admin. A username alone can
  // never grant privileges. Both paths fail closed when their secret is
  // absent, so a forgotten deploy variable never opens registration.
  const usesAdminCode = !!config.ADMIN_REGISTRATION_CODE && safeCompare(code, config.ADMIN_REGISTRATION_CODE);
  const usesInviteCode = !!config.REGISTRATION_CODE && safeCompare(code, config.REGISTRATION_CODE);
  if (!config.REGISTRATION_CODE && !config.ADMIN_REGISTRATION_CODE) {
    return sendError(reply, 403, 'registration_closed', 'Registro fechado.');
  }
  if (!usesAdminCode && !usesInviteCode) {
    return sendError(reply, 403, 'invalid_code', 'Codigo de convite invalido.');
  }

  if (!USERNAME_RE.test(username)) {
    return sendError(reply, 400, 'invalid_username', `Nome de usuario deve ter entre ${config.MIN_USERNAME_LEN} e ${config.MAX_USERNAME_LEN} caracteres (letras, numeros, . _ -).`);
  }
  if (password.length < config.MIN_PASSWORD_LEN || password.length > config.MAX_PASSWORD_LEN) {
    return sendError(reply, 400, 'weak_password', `Senha deve ter pelo menos ${config.MIN_PASSWORD_LEN} caracteres.`);
  }
  if (confirmPassword !== password) {
    return sendError(reply, 400, 'password_mismatch', 'As senhas nao coincidem.');
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = usesAdminCode
      ? await createInitialAdmin({ username, passwordHash })
      : await createUser({ username, passwordHash, role: 'user' });
  } catch (err: unknown) {
    if (err && (err as { code?: string }).code === 'username_taken') return sendError(reply, 409, 'username_taken', 'Esse nome de usuario ja esta em uso.');
    if (err && (err as { code?: string }).code === 'admin_already_exists') {
      return sendError(reply, 403, 'admin_code_used', 'O administrador inicial ja foi criado. Use um codigo de convite comum.');
    }
    throw err;
  }

  const { rawToken } = await createSession(user.id);
  setSessionCookie(request, reply, rawToken);
  // the user directory (right sidebar) for anyone already connected gets
  // the new account without reloading — plain broadcast over already-open
  // sockets, no coupling of this HTTP route to socket.io itself.
  broadcast({ t: 'user-registered', user: publicUser(user) });
  sendJson(reply, 201, { user: publicUser(user) });
}

async function handleLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ipKey = `ip:${ipOfRequest(request)}`;
  const ipBlockedSec = ratelimit.checkBlocked(ipKey);
  if (ipBlockedSec) {
    reply.header('Retry-After', String(ipBlockedSec));
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  const password = String(body.password == null ? '' : body.password);
  const userKey = `user:${username.toLowerCase()}`;

  const userBlockedSec = ratelimit.checkBlocked(userKey);
  if (userBlockedSec) {
    reply.header('Retry-After', String(userBlockedSec));
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const user = await findByUsernameLower(username);
  // a nonexistent user still verifies against a fake hash, to spend the
  // same CPU time — and the response time doesn't reveal which usernames
  // exist. The error message is also IDENTICAL for both cases.
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !ok) {
    ratelimit.recordFailure(ipKey);
    ratelimit.recordFailure(userKey);
    return sendError(reply, 401, 'invalid_credentials', 'Usuario ou senha invalidos.');
  }

  ratelimit.reset(ipKey);
  ratelimit.reset(userKey);

  if (needsRehash(user.passwordHash)) {
    hashPassword(password)
      .then((newHash) => db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, user.id)))
      .catch(() => {});
  }

  const { rawToken } = await createSession(user.id);
  setSessionCookie(request, reply, rawToken);
  sendJson(reply, 200, { user: publicUser(user) });
}

async function handleLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const tokenHash = await destroySession(cookies[config.SESSION_COOKIE]);
  if (tokenHash) disconnectSession(tokenHash);
  reply.header('Set-Cookie', clearCookie(config.SESSION_COOKIE, { secure: isSecureRequest(request.raw) }));
  reply.code(204).header('Cache-Control', 'no-store').send();
}

async function handleMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');
  sendJson(reply, 200, { user: { id: sess.userId, username: sess.username, avatar: sess.avatar, role: sess.role } });
}

export function registerAuthRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/auth/register', handleRegister);
  fastify.post('/api/auth/login', handleLogin);
  fastify.post('/api/auth/logout', handleLogout);
  fastify.get('/api/auth/me', handleMe);
}

export { ipOfRequest };
