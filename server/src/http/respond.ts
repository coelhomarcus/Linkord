import type { FastifyReply } from 'fastify';

/** Writes a JSON response with Cache-Control: no-store — no /api/*
 * response should ever be cached (session, account data). */
export function sendJson(reply: FastifyReply, status: number, body: unknown): void {
  reply.code(status).header('Cache-Control', 'no-store').send(body);
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string): void {
  sendJson(reply, status, { error: { code, message } });
}

/** Validates that the body (already parsed by Fastify) is a real JSON
 * object — Fastify's default parser accepts any valid JSON (array/null/
 * number), which no route here expects to receive. */
export function jsonBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Corpo deve ser um objeto JSON.'), { statusCode: 400, code: 'invalid_json' });
  }
  return body as Record<string, unknown>;
}
