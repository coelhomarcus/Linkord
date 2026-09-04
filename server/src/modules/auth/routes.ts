import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies, serializeCookie, clearCookie, isSecureRequest } from '../../http/cookies.js';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH } from './password.js';
import { createSession, resolveSession, destroySession } from './session.js';
import { findByUsernameLower, createUser, isAdminUsername, publicUser } from './users.js';
import { broadcast } from '../../realtime/participants.js';
import * as ratelimit from './ratelimit.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

// ---------------------------------------------------------------------------
// Rotas /api/auth/* — registro fechado por codigo de convite, login, logout,
// e "quem sou eu" (usado pelo frontend no boot pra saber se ja esta logado).
// ---------------------------------------------------------------------------

const USERNAME_RE = new RegExp(`^[A-Za-z0-9_.-]{${config.MIN_USERNAME_LEN},${config.MAX_USERNAME_LEN}}$`);

function ipOfRequest(request: FastifyRequest): string {
  if (config.TRUST_PROXY) {
    const fwd = request.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  }
  return request.raw.socket.remoteAddress || '?';
}

/** Compara em tempo constante mesmo quando os tamanhos diferem — timingSafeEqual
 * lanca nesse caso, entao ainda gastamos um compare de tamanho igual pra nao
 * vazar o tamanho do codigo certo via timing. */
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
  const body = jsonBody(request.body);
  const username = String(body.username == null ? '' : body.username).trim();
  const password = String(body.password == null ? '' : body.password);
  const confirmPassword = String(body.confirmPassword == null ? '' : body.confirmPassword);
  const code = String(body.code == null ? '' : body.code);

  // fail closed: sem codigo configurado, registro fechado — nunca "aberto por
  // esquecimento" de configuracao.
  if (!config.REGISTRATION_CODE) return sendError(reply, 403, 'registration_closed', 'Registro fechado.');
  if (!safeCompare(code, config.REGISTRATION_CODE)) return sendError(reply, 403, 'invalid_code', 'Codigo de convite invalido.');

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
  const role = isAdminUsername(username) ? 'admin' : 'user';

  let user;
  try {
    user = await createUser({ username, passwordHash, role });
  } catch (err: unknown) {
    if (err && (err as { code?: string }).code === 'username_taken') return sendError(reply, 409, 'username_taken', 'Esse nome de usuario ja esta em uso.');
    throw err;
  }

  const { rawToken } = await createSession(user.id);
  setSessionCookie(request, reply, rawToken);
  // diretorio de usuarios (sidebar direita) de quem ja esta conectado ganha
  // a conta nova sem precisar recarregar — broadcast puro via os sockets ja
  // abertos, sem acoplar essa rota HTTP ao socket.io em si.
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
  // usuario inexistente ainda verifica contra um hash de mentira, pra gastar
  // o mesmo tempo de CPU e o tempo de resposta nao denunciar quais usernames
  // existem. A mensagem de erro tambem e IDENTICA pros dois casos.
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
  await destroySession(cookies[config.SESSION_COOKIE]);
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
