import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { sendError } from './respond.js';

// Origin validation (docs/plano-rede-social.md §8.2). The session cookie is
// SameSite=Lax and bodies must be JSON, which already blocks the classic
// cross-site form post; this closes the rest for state-changing calls and the
// realtime handshake: a browser request that names an Origin must name one of
// ours. A request with NO Origin header (curl, scripts, server-to-server) is
// not a cross-site browser request and is let through.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const hostOf = (origin: string): string | null => {
  try { return new URL(origin).host.toLowerCase(); } catch { return null; }
};

export function isOriginAllowed(input: {
  origin: string | undefined;
  requestHost: string | undefined;
  appUrl: string;
  allowedOrigins: string[];
  isDev: boolean;
}): boolean {
  const { origin, requestHost, appUrl, allowedOrigins, isDev } = input;
  if (!origin) return true;
  // a literal "null" origin (sandboxed iframe, file://) is never ours
  const host = hostOf(origin);
  if (!host) return false;
  if (requestHost && host === requestHost.toLowerCase()) return true;
  const allowedHosts = [appUrl, ...allowedOrigins, ...(isDev ? DEV_ORIGINS : [])].map((o) => (o ? hostOf(o) : null));
  return allowedHosts.includes(host);
}

const currentInput = (origin: string | undefined, requestHost: string | undefined) => ({
  origin, requestHost, appUrl: config.APP_URL, allowedOrigins: config.ALLOWED_ORIGINS, isDev: config.IS_DEV,
});

/** Fastify `onRequest` hook: state-changing /api/* calls only. */
export async function originGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (SAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return;
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  if (!isOriginAllowed(currentInput(origin, request.headers.host))) {
    sendError(reply, 403, 'forbidden_origin', 'Origem não permitida.');
  }
}

/** Socket handshake check (same rule). */
export function isSocketOriginAllowed(headers: { origin?: string | string[]; host?: string | string[] }): boolean {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return isOriginAllowed(currentInput(one(headers.origin), one(headers.host)));
}
