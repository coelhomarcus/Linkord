import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Hash de senha com scrypt (node:crypto) — zero dependencia nova, sem modulo
// nativo pra compilar. Formato auto-descritivo (guarda os proprios parametros)
// pra poder subir o custo depois sem invalidar hashes antigos:
//
//   scrypt$N$r$p$<salt em base64url>$<hash em base64url>
//
// SEMPRE assincrono (crypto.scrypt, nunca scryptSync) — isso e um processo
// unico segurando todos os WebSockets da sala; uma chamada sincrona de ~60ms
// congela a sala inteira a cada login.
// ---------------------------------------------------------------------------

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
// scrypt exige maxmem >= ~128*N*r*2 ou lanca "memory limit exceeded" (o
// padrao do Node e 32MB, insuficiente pra N=32768/r=8).
const MAXMEM = 64 * 1024 * 1024;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, derived) => {
      if (err) reject(err); else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64url(salt)}$${b64url(derived)}`;
}

/** Nunca lanca — uma linha corrompida/formato desconhecido so falha a
 * verificacao, nao derruba o handler de login. */
export async function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean> {
  try {
    const parts = String(encoded || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    // limites de sanidade — uma linha corrompida no banco nao pode virar um
    // pedido de scrypt com parametros absurdos (DoS via memoria/CPU).
    if (!Number.isInteger(N) || N < 1024 || N > 2 ** 20) return false;
    if (!Number.isInteger(r) || r < 1 || r > 32) return false;
    if (!Number.isInteger(p) || p < 1 || p > 16) return false;
    const salt = Buffer.from(parts[4]!, 'base64url');
    const stored = Buffer.from(parts[5]!, 'base64url');
    if (stored.length === 0) return false;
    const derived = await scryptAsync(password, salt, stored.length, { N, r, p, maxmem: MAXMEM });
    // timingSafeEqual lanca se os tamanhos diferirem — ja garantido igual
    // (derivamos com keylen = stored.length), mas o guard acima cobre o caso
    // de stored vazio virar um buffer de tamanho 0 incomparavel.
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

/** Hash "de mentira" contra o formato atual — usado quando o username nao
 * existe, pra gastar o mesmo tempo de CPU de uma verificacao real e o tempo
 * de resposta do login nao denunciar quais usernames existem. */
export const DUMMY_HASH = `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64url(crypto.randomBytes(16))}$${b64url(crypto.randomBytes(PARAMS.keylen))}`;

/** true se o hash foi gerado com parametros mais fracos que os atuais —
 * chamar apos um login bem-sucedido pra re-hashear com custo em dia. */
export function needsRehash(encoded: string | null | undefined): boolean {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < PARAMS.N;
}
