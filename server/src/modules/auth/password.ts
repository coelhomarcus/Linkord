import crypto from 'node:crypto';

// Password hashing with scrypt (node:crypto) — no new dependency, no native
// module to compile. Self-describing format (stores its own params) so
// cost can go up later without invalidating old hashes:
//
//   scrypt$N$r$p$<salt base64url>$<hash base64url>
//
// ALWAYS async (crypto.scrypt, never scryptSync) — this is a single
// process holding every WebSocket in the room; a ~60ms sync call would
// freeze the whole room on every login.

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
// scrypt requires maxmem >= ~128*N*r*2 or it throws "memory limit
// exceeded" (Node's default is 32MB, not enough for N=32768/r=8).
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

/** Never throws — a corrupt row or unknown format just fails verification,
 * doesn't crash the login handler. */
export async function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean> {
  try {
    const parts = String(encoded || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    // sanity limits — a corrupt DB row can't turn into an absurd scrypt
    // request (memory/CPU DoS).
    if (!Number.isInteger(N) || N < 1024 || N > 2 ** 20) return false;
    if (!Number.isInteger(r) || r < 1 || r > 32) return false;
    if (!Number.isInteger(p) || p < 1 || p > 16) return false;
    const salt = Buffer.from(parts[4]!, 'base64url');
    const stored = Buffer.from(parts[5]!, 'base64url');
    if (stored.length === 0) return false;
    const derived = await scryptAsync(password, salt, stored.length, { N, r, p, maxmem: MAXMEM });
    // timingSafeEqual throws on a length mismatch — already guaranteed
    // equal (we derive with keylen = stored.length), but the guard above
    // covers an empty stored value becoming an incomparable zero-length buffer.
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

/** "Fake" hash in the current format — used when the username doesn't
 * exist, to spend the same CPU time as a real check so login response time
 * doesn't leak which usernames exist. */
export const DUMMY_HASH = `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64url(crypto.randomBytes(16))}$${b64url(crypto.randomBytes(PARAMS.keylen))}`;

/** True if the hash was generated with weaker params than current — call
 * after a successful login to rehash with up-to-date cost. */
export function needsRehash(encoded: string | null | undefined): boolean {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < PARAMS.N;
}
