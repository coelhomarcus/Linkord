import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendJson, sendError, jsonBody } from '../../src/http/respond.js';
import type { FastifyReply } from 'fastify';

/** Minimal fake of FastifyReply — only the 3 chainable methods sendJson/
 * sendError actually call, recording everything for later inspection. */
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
  test('sets status, Cache-Control: no-store, and the sent body', () => {
    const { reply, calls } = fakeReply();
    sendJson(reply, 201, { ok: true });
    assert.equal(calls.status, 201);
    assert.equal(calls.headers['Cache-Control'], 'no-store');
    assert.deepEqual(calls.body, { ok: true });
  });
});

describe('sendError', () => {
  test('wraps code/message in the { error: { code, message } } format', () => {
    const { reply, calls } = fakeReply();
    sendError(reply, 404, 'not_found', 'Route not found.');
    assert.equal(calls.status, 404);
    assert.deepEqual(calls.body, { error: { code: 'not_found', message: 'Route not found.' } });
  });
});

describe('jsonBody', () => {
  test('a valid object passes through', () => {
    assert.deepEqual(jsonBody({ a: 1 }), { a: 1 });
  });

  // Fastify's default parser accepts any valid JSON (array/null/
  // number/string) — no route here expects to receive that, so it needs to
  // keep rejecting it to preserve the old readJsonBody's behavior (which
  // only accepted an object).
  for (const bad of [null, undefined, [], [1, 2], 'text', 42, true]) {
    test(`rejects a body that is not an object: ${JSON.stringify(bad)}`, () => {
      assert.throws(() => jsonBody(bad), /Corpo deve ser um objeto JSON/);
    });
  }

  test('thrown error has statusCode 400 and code invalid_json (so the global setErrorHandler formats it correctly)', () => {
    try {
      jsonBody(null);
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal((err as { statusCode?: number }).statusCode, 400);
      assert.equal((err as { code?: string }).code, 'invalid_json');
    }
  });
});
