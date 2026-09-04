import type { FastifyReply } from 'fastify';

/** Escreve uma resposta JSON com Cache-Control: no-store — nenhuma resposta
 * de /api/* deve ser cacheada (sessao, dados de conta). */
export function sendJson(reply: FastifyReply, status: number, body: unknown): void {
  reply.code(status).header('Cache-Control', 'no-store').send(body);
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string): void {
  sendJson(reply, status, { error: { code, message } });
}

/** Valida que o corpo (ja parseado pelo Fastify) e um objeto JSON de verdade
 * — o parser padrao do Fastify aceita qualquer JSON valido (array/null/
 * numero), o que nenhuma rota aqui espera receber. */
export function jsonBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Corpo deve ser um objeto JSON.'), { statusCode: 400, code: 'invalid_json' });
  }
  return body as Record<string, unknown>;
}
