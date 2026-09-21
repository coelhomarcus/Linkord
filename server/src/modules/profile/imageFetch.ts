import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isBlockedIp } from '../../net/ssrfGuard.js';

// SSRF-guarded image download — today only used by the avatar/banner "usar
// URL" flow (avatarUpload.ts), kept in its own module since it's pure
// network infra with no attachment-storage/DB concerns of its own. The
// actual IP-safety check (isBlockedIp) lives in net/ssrfGuard.ts, shared
// with link-preview.ts — same SSRF concern, same rules.

export const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Resolves `hostname` and returns one of its IPs, but only if EVERY address
 * it resolves to is a public one — a domain that answers with even one
 * internal/loopback address is treated as unsafe entirely (a common anti-DNS-
 * rebinding stance: fewer surprises than picking-and-choosing addresses). */
function resolveSafePublicIp(hostname: string): Promise<string | null> {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) return resolve(null);
      for (const { address, family } of addresses) {
        if (isBlockedIp(address, family)) return resolve(null);
      }
      resolve(addresses[0]!.address);
    });
  });
}

const MAX_IMAGE_URL_REDIRECTS = 5;
const IMAGE_URL_FETCH_TIMEOUT_MS = 10_000;

// '__redirect__' is internal: it carries the next URL in `message` and never leaves this file
type FetchImageError = 'invalid_url' | 'too_many_redirects' | 'fetch_failed' | 'invalid_type' | 'file_too_large' | '__redirect__';
type FetchImageResult = { buffer: Buffer } | { error: FetchImageError; message: string };

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
  const family = net.isIPv6(ip) ? 6 : 4;
  // Node's net.connect defaults to autoSelectFamily (Happy Eyeballs) since
  // v20 — its internal lookupAndConnectMultiple path calls this with
  // `options.all: true` and expects an ARRAY of {address, family} back, not
  // the single (err, address, family) tuple dns.lookup's non-`all` form
  // uses. Getting this wrong doesn't error where you'd expect — it throws a
  // confusing "Invalid IP address: undefined" deep in node:net instead, and
  // every fetch fails with 'fetch_failed' regardless of the URL being fine.
  const pinnedLookup: typeof dns.lookup = ((_hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (err: null, address: string | { address: string; family: number }[], family?: number) => void;
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) {
      cb(null, [{ address: ip, family }]);
    } else {
      cb(null, ip, family);
    }
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
