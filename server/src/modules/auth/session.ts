import crypto from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { config } from '../../config/env.js';
import type { SessionUser } from '../../types.js';

// ---------------------------------------------------------------------------
// Sessoes de login. O cookie carrega um token cru de 32 bytes; so o sha256
// dele (`tokenHash`) mora no banco — um vazamento do banco entao nao vira
// sessao ativa reproduzivel.
//
// O banco e remoto, entao resolver a sessao a cada handshake do Socket.IO (ou
// a cada request HTTP) seria um round-trip WAN por reconexao. Por isso ha um
// cache em memoria de 60s — barato de errar pra mais (so atrasa em ate 60s
// ver uma troca de avatar ou um logout que aconteceu em OUTRA aba), caro de
// errar pra menos (WAN em toda reconexao de rede instavel).
// ---------------------------------------------------------------------------

const SESSION_CACHE_TTL_MS = 60 * 1000;
const LAST_SEEN_STALE_MS = 60 * 60 * 1000; // so reescreve lastSeenAt se > 1h velho

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

/** Cria uma sessao nova e devolve o TOKEN CRU (vai no cookie) — nunca
 * persistido em texto puro, so o hash. */
export async function createSession(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash, userId, expiresAt });
  return { rawToken, expiresAt };
}

/** Resolve um token cru (de cookie) pro usuario dono da sessao, ou null se
 * invalida/expirada/inexistente. */
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
    // fire-and-forget: atraso/erro aqui nao deve travar a resolucao da sessao
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

/** Limpa sessoes vencidas do banco — chamado periodicamente pelo boot
 * (src/index.ts), nao a cada request. */
export async function sweepExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Chamado por modules/moderation.ts ao apagar uma conta — a linha de
 * sessions ja sumiu via CASCADE (ver schema.ts), mas esse cache local pode
 * segurar uma entrada VALIDA por ate SESSION_CACHE_TTL_MS depois disso (ele
 * so expira por tempo, nao sabe que o banco mudou). Sem isso, quem acabou de
 * ser apagado continuaria autenticado — reconectando ou so mandando outra
 * mensagem — por ate 60s. Varre o Map inteiro (nao ha indice por userId, so
 * por tokenHash) — aceitavel: cache pequeno, e apagar conta e raro. */
export function invalidateSessionsForUser(userId: string): void {
  for (const [tokenHash, entry] of cache) {
    if (entry.value && entry.value.userId === userId) cache.delete(tokenHash);
  }
}
