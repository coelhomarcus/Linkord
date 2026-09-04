import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendJson, sendError, jsonBody } from './respond.js';
import type { FastifyReply } from 'fastify';

/** Fake minimo de FastifyReply — so os 3 metodos encadeaveis que sendJson/
 * sendError de fato chamam, gravando tudo pra inspecionar depois. */
function fakeReply() {
  const calls: { headers: Record<string, unknown>; status?: number; body?: unknown } = { headers: {} };
  const reply = {
    code(status: number) { calls.status = status; return reply; },
    header(name: string, value: unknown) { calls.headers[name] = value; return reply; },
    send(body?: unknown) { calls.body = body; return reply; },
  };
  return { reply: reply as unknown as FastifyReply, calls };
}

describe('sendJson', () => {
  test('seta status, Cache-Control: no-store, e o corpo mandado', () => {
    const { reply, calls } = fakeReply();
    sendJson(reply, 201, { ok: true });
    assert.equal(calls.status, 201);
    assert.equal(calls.headers['Cache-Control'], 'no-store');
    assert.deepEqual(calls.body, { ok: true });
  });
});

describe('sendError', () => {
  test('embrulha code/message no formato { error: { code, message } }', () => {
    const { reply, calls } = fakeReply();
    sendError(reply, 404, 'not_found', 'Rota nao encontrada.');
    assert.equal(calls.status, 404);
    assert.deepEqual(calls.body, { error: { code: 'not_found', message: 'Rota nao encontrada.' } });
  });
});

describe('jsonBody', () => {
  test('objeto valido passa direto', () => {
    assert.deepEqual(jsonBody({ a: 1 }), { a: 1 });
  });

  // o parser padrao do Fastify aceita qualquer JSON valido (array/null/
  // numero/string) — nenhuma rota daqui espera receber isso, precisa
  // continuar rejeitando pra manter o mesmo comportamento do antigo
  // readJsonBody (que so aceitava objeto).
  for (const bad of [null, undefined, [], [1, 2], 'texto', 42, true]) {
    test(`rejeita corpo que nao e objeto: ${JSON.stringify(bad)}`, () => {
      assert.throws(() => jsonBody(bad), /Corpo deve ser um objeto JSON/);
    });
  }

  test('erro lancado tem statusCode 400 e code invalid_json (pro setErrorHandler global formatar certo)', () => {
    try {
      jsonBody(null);
      assert.fail('deveria ter lancado');
    } catch (err) {
      assert.equal((err as { statusCode?: number }).statusCode, 400);
      assert.equal((err as { code?: string }).code, 'invalid_json');
    }
  });
});
