import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies, serializeCookie, clearCookie, isSecureRequest } from '../../http/cookies.js';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH } from './password.js';
import { createSession, resolveSession, destroyAllSessionsForUser, destroySession } from './session.js';
import { findByEmailLower, findByUsernameLower, createUser, isAdminUsername, isValidEmail, normalizeEmail, privateUser, publicUser, updateEmail, updatePassword } from './users.js';
import { issueAuthCode, verifyAuthCode, type AuthCodePurpose } from './codes.js';
import { sendAuthCodeEmail } from './email.js';
import { broadcast } from '../../realtime/participants.js';
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
  // REGISTRATION_CODE is the only gate keeping a self-hosted instance
  // private — without a lockout here it's brute-forceable at unlimited
  // speed. Same IP-lockout scheme as login (see ratelimit.ts), but its own
  // key namespace so failed logins/registrations from one IP don't block
  // the other.
  const ipKey = `reg-ip:${ipOfRequest(request)}`;
  const ipBlockedSec = ratelimit.checkBlocked(ipKey);
  if (ipBlockedSec) {
    reply.header('Retry-After', String(ipBlockedSec));
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  const password = String(body.password == null ? '' : body.password);
  const confirmPassword = String(body.confirmPassword == null ? '' : body.confirmPassword);
  const code = String(body.code == null ? '' : body.code);

  // fail closed: no code configured means registration is closed — never
  // "open by a forgotten config."
  if (!config.REGISTRATION_CODE) return sendError(reply, 403, 'registration_closed', 'Registro fechado.');
  if (!safeCompare(code, config.REGISTRATION_CODE)) {
    ratelimit.recordFailure(ipKey);
    return sendError(reply, 403, 'invalid_code', 'Código de convite inválido.');
  }
  ratelimit.reset(ipKey);

  if (!USERNAME_RE.test(username)) {
    return sendError(reply, 400, 'invalid_username', `Nome de usuário deve ter entre ${config.MIN_USERNAME_LEN} e ${config.MAX_USERNAME_LEN} caracteres (letras, números, . _ -).`);
  }
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (password.length < config.MIN_PASSWORD_LEN || password.length > config.MAX_PASSWORD_LEN) {
    return sendError(reply, 400, 'weak_password', `Senha deve ter pelo menos ${config.MIN_PASSWORD_LEN} caracteres.`);
  }
  if (confirmPassword !== password) {
    return sendError(reply, 400, 'password_mismatch', 'As senhas não coincidem.');
  }

  const passwordHash = await hashPassword(password);
  const role = isAdminUsername(username) ? 'admin' : 'user';

  if (await findByEmailLower(email)) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');

  let user;
  try {
    user = await createUser({ username, email, passwordHash, role });
  } catch (err: unknown) {
    if (err && (err as { code?: string }).code === 'account_identity_taken') return sendError(reply, 409, 'username_taken', 'Esse nome de usuário ou e-mail já está em uso.');
    throw err;
  }

  const { rawToken } = await createSession(user.id);
  setSessionCookie(request, reply, rawToken);
  // the user directory (right sidebar) for anyone already connected gets
  // the new account without reloading — plain broadcast over already-open
  // sockets, no coupling of this HTTP route to socket.io itself.
  broadcast({ t: 'user-registered', user: publicUser(user) });
  sendJson(reply, 201, { user: privateUser(user) });
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
    return sendError(reply, 401, 'invalid_credentials', 'Usuário ou senha inválidos.');
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
  sendJson(reply, 200, { user: privateUser(user) });
}

async function handleLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  await destroySession(cookies[config.SESSION_COOKIE]);
  reply.header('Set-Cookie', clearCookie(config.SESSION_COOKIE, { secure: isSecureRequest(request.raw) }));
  reply.code(204).header('Cache-Control', 'no-store').send();
}

async function handleMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  sendJson(reply, 200, {
    user: {
      id: sess.userId,
      username: sess.username,
      email: sess.email,
      displayName: sess.displayName,
      avatar: sess.avatar,
      avatarColor: sess.avatarColor,
      banner: sess.banner,
      bio: sess.bio,
      profileLinks: sess.profileLinks,
      role: sess.role,
    },
  });
}

function purposeError(reply: FastifyReply, reason: 'invalid_code' | 'code_expired' | 'too_many_attempts'): void {
  const messages = {
    invalid_code: 'Código inválido.',
    code_expired: 'Código expirado. Solicite um novo código.',
    too_many_attempts: 'Limite de tentativas atingido. Solicite um novo código.',
  } as const;
  sendError(reply, 400, reason, messages[reason]);
}

function sessionForRequest(request: FastifyRequest) {
  const cookies = parseCookies(request.headers.cookie || '');
  return resolveSession(cookies[config.SESSION_COOKIE]);
}

async function issueAndSendCode(userId: string, email: string, purpose: AuthCodePurpose): Promise<void> {
  const code = await issueAuthCode(userId, purpose, email);
  try {
    await sendAuthCodeEmail({ to: email, code, purpose });
  } catch (err) {
    console.error('[auth] falha ao enviar código:', err instanceof Error ? err.message : err);
    throw err;
  }
}

async function handleRecoveryRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = jsonBody(request.body);
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');

  const ipKey = `recovery-ip:${ipOfRequest(request)}`;
  const emailKey = `recovery-email:${email}`;
  const blocked = ratelimit.checkBlocked(ipKey) || ratelimit.checkBlocked(emailKey);
  if (blocked) {
    reply.header('Retry-After', String(blocked));
    return sendError(reply, 429, 'rate_limited', 'Muitas solicitações. Tente novamente mais tarde.');
  }
  ratelimit.recordFailure(ipKey);
  ratelimit.recordFailure(emailKey);

  const user = await findByEmailLower(email);
  if (user) {
    try {
      await issueAndSendCode(user.id, email, 'password_reset');
    } catch { /* Keep the response identical so recovery never enumerates accounts. */ }
  }
  sendJson(reply, 200, { ok: true });
}

async function handleRecoveryReset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = jsonBody(request.body);
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  const code = String(body.code == null ? '' : body.code).trim();
  const password = String(body.password == null ? '' : body.password);
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');
  if (password.length < config.MIN_PASSWORD_LEN || password.length > config.MAX_PASSWORD_LEN) {
    return sendError(reply, 400, 'weak_password', `Senha deve ter pelo menos ${config.MIN_PASSWORD_LEN} caracteres.`);
  }

  const user = await findByEmailLower(email);
  if (!user) return sendError(reply, 400, 'invalid_code', 'Código inválido.');
  const result = await verifyAuthCode(user.id, 'password_reset', email, code);
  if (!result.ok) return purposeError(reply, result.reason);

  await updatePassword(user.id, await hashPassword(password));
  await destroyAllSessionsForUser(user.id);
  sendJson(reply, 200, { ok: true });
}

async function handleLinkEmail(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (sess.email) return sendError(reply, 409, 'email_already_set', 'Esta conta já possui um e-mail.');
  if (await findByEmailLower(email)) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');
  const user = await updateEmail(sess.userId, email);
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  sendJson(reply, 200, { user: privateUser(user) });
}

async function handleEmailChangeRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (sess.email && normalizeEmail(sess.email) === email) return sendError(reply, 400, 'same_email', 'Informe um e-mail diferente do atual.');
  const existing = await findByEmailLower(email);
  if (existing && existing.id !== sess.userId) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');
  const changeKey = `email-change:${sess.userId}`;
  const blocked = ratelimit.checkBlocked(changeKey);
  if (blocked) {
    reply.header('Retry-After', String(blocked));
    return sendError(reply, 429, 'rate_limited', 'Muitas solicitações. Tente novamente mais tarde.');
  }
  ratelimit.recordFailure(changeKey);
  try {
    await issueAndSendCode(sess.userId, email, 'email_change');
  } catch {
    return sendError(reply, 503, 'email_unavailable', 'Não foi possível enviar o código agora. Tente novamente mais tarde.');
  }
  sendJson(reply, 200, { ok: true });
}

async function handleEmailChangeConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionForRequest(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const body = jsonBody(request.body);
  const email = normalizeEmail(String(body.email == null ? '' : body.email));
  const code = String(body.code == null ? '' : body.code).trim();
  if (!isValidEmail(email)) return sendError(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
  if (!/^\d{6}$/.test(code)) return sendError(reply, 400, 'invalid_code', 'Informe o código de 6 dígitos.');
  const result = await verifyAuthCode(sess.userId, 'email_change', email, code);
  if (!result.ok) return purposeError(reply, result.reason);
  const existing = await findByEmailLower(email);
  if (existing && existing.id !== sess.userId) return sendError(reply, 409, 'email_taken', 'Esse e-mail já está em uso.');
  const user = await updateEmail(sess.userId, email);
  if (!user) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  sendJson(reply, 200, { user: privateUser(user) });
}

export function registerAuthRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/auth/register', handleRegister);
  fastify.post('/api/auth/login', handleLogin);
  fastify.post('/api/auth/logout', handleLogout);
  fastify.get('/api/auth/me', handleMe);
  fastify.post('/api/auth/recovery/request', handleRecoveryRequest);
  fastify.post('/api/auth/recovery/reset', handleRecoveryReset);
  fastify.post('/api/auth/email/link', handleLinkEmail);
  fastify.post('/api/auth/email/change/request', handleEmailChangeRequest);
  fastify.post('/api/auth/email/change/confirm', handleEmailChangeConfirm);
}

export { ipOfRequest };
