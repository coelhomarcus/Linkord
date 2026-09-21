import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { logger, type LogFields } from '../../lib/logger.js';
import { parseCookies } from '../../http/cookies.js';
import { jsonBody, sendError } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { resolveSession } from '../auth/session.js';

// Errors the BROWSER hit, written into the same log as the server's own so one
// stream tells the whole story. The client is untrusted: only warn/error, every
// field is cut to a small size, and everything passes through the logger's
// redaction like any other record.

const log = logger.child({ component: 'client' });

const LIMITS = { message: 500, stack: 4000, url: 300, userAgent: 200, route: 200, appVersion: 40, breadcrumbs: 5, breadcrumbText: 200 } as const;

export interface ClientLogEntry {
  level: 'warn' | 'error';
  message: string;
  stack?: string;
  url?: string;
  route?: string;
  userAgent?: string;
  appVersion?: string;
  context?: LogFields;
  breadcrumbs?: string[];
}

const cut = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? (value.length > max ? `${value.slice(0, max)}…` : value) : undefined;

/** Validates and trims what the client sent; null = not a usable entry. */
export function parseClientLog(body: Record<string, unknown>): ClientLogEntry | null {
  if (body.level !== 'warn' && body.level !== 'error') return null;
  const message = cut(body.message, LIMITS.message);
  if (!message) return null;
  const breadcrumbs = Array.isArray(body.breadcrumbs)
    ? body.breadcrumbs.slice(-LIMITS.breadcrumbs).map((b) => cut(b, LIMITS.breadcrumbText)).filter((b): b is string => !!b)
    : undefined;
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) && JSON.stringify(body.context).length <= 1000
    ? (body.context as LogFields) : undefined;
  return {
    level: body.level, message, stack: cut(body.stack, LIMITS.stack), url: cut(body.url, LIMITS.url), route: cut(body.route, LIMITS.route),
    userAgent: cut(body.userAgent, LIMITS.userAgent), appVersion: cut(body.appVersion, LIMITS.appVersion), context, breadcrumbs,
  };
}

async function handleClientLog(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  // by IP and by account: a signed-out page can report too, but cannot flood
  if (!floodControl.allow(`client-log:${request.ip}`, { windowMs: 60_000, max: 30 })) return void reply.code(204).send();
  const entry = parseClientLog(jsonBody(request.body));
  if (!entry) return sendError(reply, 400, 'invalid_log', 'Registro inválido.');

  const { level, message, ...rest } = entry;
  const fields = { ...rest, userId: sess?.userId ?? null, reqId: request.id };
  if (level === 'error') log.error(message, undefined, fields); else log.warn(message, fields);
  reply.code(204).send();
}

export function registerClientLogRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/client-logs', handleClientLog);
}
