import type { IncomingMessage } from 'node:http';
import { config } from '../config/env.js';

// Hand-rolled cookie parse/serialize — kept manual even after moving to
// Fastify (see http/app.ts) since Socket.IO's own handshake auth uses the
// same parseCookies; a framework cookie plugin would mean a second
// implementation to keep in sync.

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const value = part.slice(idx + 1).trim();
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

/** Decides the cookie's Secure attribute. 'auto' (default) trusts
 * X-Forwarded-Proto when TRUST_PROXY is on — the deploy's Caddyfile/
 * nginx.conf already send that header. Without it, the Secure cookie just
 * wouldn't save on local http://localhost dev. */
export function isSecureRequest(req: IncomingMessage): boolean {
  if (config.COOKIE_SECURE === '1') return true;
  if (config.COOKIE_SECURE === '0') return false;
  if (req.socket && (req.socket as { encrypted?: boolean }).encrypted) return true;
  if (config.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') return true;
  return false;
}

export function serializeCookie(name: string, value: string, { maxAgeSec, secure }: { maxAgeSec?: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (typeof maxAgeSec === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, { secure }: { secure: boolean }): string {
  return serializeCookie(name, '', { maxAgeSec: 0, secure });
}
