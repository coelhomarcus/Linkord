import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// SSRF-guarded image download — today only used by the avatar/banner "usar
// URL" flow (avatarUpload.ts), kept in its own module since it's pure
// network infra with no attachment-storage/DB concerns of its own.

export const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Whether `address` (a resolved, dotted/colon-form IP — never a hostname)
 * falls in a loopback/private/link-local/reserved range. Used to keep
 * fetchImageFromUrl from being used as an SSRF pivot into the local network
 * or cloud metadata endpoints (169.254.169.254) — see there. */
export function isDisallowedIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 127 || a === 10 || a >= 224) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    return false;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isDisallowedIp(mapped[1]!);
    return false;
  }
  return true; // not a recognizable literal IP — reject rather than guess
}

/** Resolves `hostname` and returns one of its IPs, but only if EVERY address
 * it resolves to is a public one — a domain that answers with even one
 * internal/loopback address is treated as unsafe entirely (a common anti-DNS-
 * rebinding stance: fewer surprises than picking-and-choosing addresses). */
function resolveSafePublicIp(hostname: string): Promise<string | null> {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) return resolve(null);
      for (const { address } of addresses) {
        if (isDisallowedIp(address)) return resolve(null);
      }
      resolve(addresses[0]!.address);
    });
  });
}

const MAX_IMAGE_URL_REDIRECTS = 5;
const IMAGE_URL_FETCH_TIMEOUT_MS = 10_000;

type FetchImageResult = { buffer: Buffer } | { error: string; message: string };

/** Downloads an image from a user-supplied URL for the "usar URL" avatar/
 * banner flow. Guards against SSRF (fetching internal services/cloud
 * metadata on the server's behalf) by resolving the hostname ourselves,
 * rejecting anything that answers with a private/loopback/link-local
 * address, and then pinning the actual connection to that already-checked
 * IP via the `lookup` option — so a DNS answer that changes between the
 * check and the request (rebinding) can't slip a different address in.
 * Redirects are followed manually (capped) so each hop gets the same
 * scrutiny; a bare `fetch()` with default redirect handling would only
 * ever validate the first URL. */
export async function fetchImageFromUrl(rawUrl: string, maxBytes: number, redirectsLeft = MAX_IMAGE_URL_REDIRECTS): Promise<FetchImageResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: 'invalid_url', message: 'URL inválida.' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return { error: 'invalid_url', message: 'URL inválida.' };
  }

  const ip = await resolveSafePublicIp(parsed.hostname);
  if (!ip) return { error: 'invalid_url', message: 'Essa URL não pode ser usada.' };

  const client = parsed.protocol === 'https:' ? https : http;
  const pinnedLookup: typeof dns.lookup = ((_hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (err: null, address: string, family: number) => void;
    cb(null, ip, net.isIPv6(ip) ? 6 : 4);
  }) as typeof dns.lookup;

  return new Promise<FetchImageResult>((resolve) => {
    let settled = false;
    const settle = (result: FetchImageResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = client.request(parsed, {
      lookup: pinnedLookup,
      servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
      timeout: IMAGE_URL_FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'Linkord-ImageFetch/1.0' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return settle({ error: 'too_many_redirects', message: 'Muitos redirecionamentos.' });
        let nextUrl: string;
        try {
          nextUrl = new URL(res.headers.location, parsed).toString();
        } catch {
          return settle({ error: 'invalid_url', message: 'URL inválida.' });
        }
        settle({ error: '__redirect__', message: nextUrl });
        return;
      }
      if (status !== 200) {
        res.resume();
        return settle({ error: 'fetch_failed', message: 'Não foi possível baixar a imagem.' });
      }
      const contentType = String(res.headers['content-type'] || '').split(';')[0]!.trim();
      if (!AVATAR_MIME_TYPES.has(contentType)) {
        res.resume();
        return settle({ error: 'invalid_type', message: 'Formato inválido. Use PNG, JPEG, GIF ou WEBP.' });
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          settle({ error: 'file_too_large', message: 'Imagem muito grande.' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => settle({ buffer: Buffer.concat(chunks) }));
      res.on('error', () => settle({ error: 'fetch_failed', message: 'Não foi possível baixar a imagem.' }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => settle({ error: 'fetch_failed', message: 'Não foi possível baixar a imagem.' }));
    req.end();
  }).then((result) => {
    if ('error' in result && result.error === '__redirect__') {
      return fetchImageFromUrl(result.message, maxBytes, redirectsLeft - 1);
    }
    return result;
  });
}
