import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, redact, serializeError } from '../../src/lib/logger.js';

const capture = (opts: Parameters<typeof createLogger>[0] = {}) => {
  const lines: { line: string; level: string }[] = [];
  const log = createLogger({ format: 'json', level: 'debug', now: () => new Date('2026-01-01T00:00:00Z'), ...opts, write: (line, level) => lines.push({ line, level }) });
  return { log, lines };
};

describe('redact', () => {
  it('hides sensitive keys at any depth, case-insensitively', () => {
    const out = redact({ user: 'ana', password: 'x', nested: { Token: 'abc', deep: [{ cookie: 'c', ok: 1 }] }, email: 'a@b.c', apiKey: 'k', code: '123456' }) as Record<string, any>;
    assert.equal(out.user, 'ana');
    for (const value of [out.password, out.nested.Token, out.nested.deep[0].cookie, out.email, out.apiKey, out.code]) assert.equal(value, '[redacted]');
    assert.equal(out.nested.deep[0].ok, 1);
  });

  it('does not confuse similar-looking fields: "codeVerifier" does not exist, but "conversationId" and "code" are handled correctly', () => {
    const out = redact({ conversationId: 'c1', userCode: 'x', code: 'y' }) as Record<string, unknown>;
    assert.equal(out.conversationId, 'c1');
    assert.equal(out.userCode, 'x');
    assert.equal(out.code, '[redacted]');
  });

  it('truncates long strings, breaks cycles and caps depth', () => {
    const cyc: Record<string, unknown> = { a: 1 }; cyc.self = cyc;
    assert.equal((redact(cyc) as any).self, '[circular]');
    assert.match(redact('x'.repeat(5000)) as string, /…\[\+4000\]$/);
    let deep: any = { end: true };
    for (let i = 0; i < 12; i++) deep = { deep };
    assert.match(JSON.stringify(redact(deep)), /max-depth/);
  });

  it('errors become name/message/stack and bigint becomes a string', () => {
    const out = redact({ e: new Error('boom'), n: 10n }) as any;
    assert.equal(out.e.message, 'boom');
    assert.equal(out.n, '10');
    assert.equal(serializeError('text').message, 'text');
  });
});

describe('logger', () => {
  it('emits one valid JSON line per record, with time, level and message', () => {
    const { log, lines } = capture();
    log.info('hello', { a: 1 });
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!.line), { time: '2026-01-01T00:00:00.000Z', level: 'info', msg: 'hello', a: 1 });
  });

  it('filters by level', () => {
    const { log, lines } = capture({ level: 'warn' });
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e', new Error('x'));
    assert.deepEqual(lines.map((l) => JSON.parse(l.line).level), ['warn', 'error']);
  });

  it('warn and error go to the error channel; info does not', () => {
    const { log, lines } = capture();
    log.info('i'); log.warn('w'); log.error('e');
    assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'error']);
  });

  it('child inherits the context and the record\'s own field takes precedence', () => {
    const { log, lines } = capture();
    log.child({ component: 'socket', k: 1 }).child({ k: 2 }).info('x');
    const rec = JSON.parse(lines[0]!.line);
    assert.equal(rec.component, 'socket');
    assert.equal(rec.k, 2);
  });

  it('error serializes the error (with stack) and redacts sensitive fields alongside it', () => {
    const { log, lines } = capture();
    log.error('failed', new Error('boom'), { password: 'secret', userId: 'u1' });
    const rec = JSON.parse(lines[0]!.line);
    assert.equal(rec.err.message, 'boom');
    assert.match(rec.err.stack, /Error: boom/);
    assert.equal(rec.password, '[redacted]');
    assert.equal(rec.userId, 'u1');
    assert.equal(lines[0]!.line.includes('secret'), false);
  });

  it('timer records the duration in ms', () => {
    const { log, lines } = capture();
    const done = log.timer('info', 'operation', { job: 'x' });
    done({ extra: true });
    const rec = JSON.parse(lines[0]!.line);
    assert.equal(rec.msg, 'operation');
    assert.equal(rec.extra, true);
    assert.equal(typeof rec.ms, 'number');
  });

  it('pretty format is readable, on one line, with the component', () => {
    const { log, lines } = capture({ format: 'pretty' });
    log.child({ component: 'auth' }).warn('login failed', { username: 'ana' });
    assert.match(lines[0]!.line, /WARN\s+\[auth\] login failed \{"username":"ana"\}$/);
  });

  it('a write that throws never brings down the caller', () => {
    const log = createLogger({ level: 'debug', write: () => { throw new Error('disk full'); } });
    assert.doesNotThrow(() => log.error('x', new Error('y')));
  });
});
