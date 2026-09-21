import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, redact, serializeError } from '../../src/lib/logger.js';

const capture = (opts: Parameters<typeof createLogger>[0] = {}) => {
  const lines: { line: string; level: string }[] = [];
  const log = createLogger({ format: 'json', level: 'debug', now: () => new Date('2026-01-01T00:00:00Z'), ...opts, write: (line, level) => lines.push({ line, level }) });
  return { log, lines };
};

describe('redact', () => {
  it('esconde chaves sensiveis em qualquer profundidade, sem diferenciar maiusculas', () => {
    const out = redact({ user: 'ana', password: 'x', nested: { Token: 'abc', deep: [{ cookie: 'c', ok: 1 }] }, email: 'a@b.c', apiKey: 'k', code: '123456' }) as Record<string, any>;
    assert.equal(out.user, 'ana');
    for (const value of [out.password, out.nested.Token, out.nested.deep[0].cookie, out.email, out.apiKey, out.code]) assert.equal(value, '[redacted]');
    assert.equal(out.nested.deep[0].ok, 1);
  });

  it('nao confunde campos parecidos: "codeVerifier" nao existe, mas "conversationId" e "code" sim sao tratados corretamente', () => {
    const out = redact({ conversationId: 'c1', userCode: 'x', code: 'y' }) as Record<string, unknown>;
    assert.equal(out.conversationId, 'c1');
    assert.equal(out.userCode, 'x');
    assert.equal(out.code, '[redacted]');
  });

  it('corta strings longas, quebra ciclos e limita a profundidade', () => {
    const cyc: Record<string, unknown> = { a: 1 }; cyc.self = cyc;
    assert.equal((redact(cyc) as any).self, '[circular]');
    assert.match(redact('x'.repeat(5000)) as string, /…\[\+4000\]$/);
    let deep: any = { end: true };
    for (let i = 0; i < 12; i++) deep = { deep };
    assert.match(JSON.stringify(redact(deep)), /max-depth/);
  });

  it('erros viram nome/mensagem/stack e bigint vira string', () => {
    const out = redact({ e: new Error('boom'), n: 10n }) as any;
    assert.equal(out.e.message, 'boom');
    assert.equal(out.n, '10');
    assert.equal(serializeError('texto').message, 'texto');
  });
});

describe('logger', () => {
  it('emite uma linha JSON valida por registro, com hora, nivel e mensagem', () => {
    const { log, lines } = capture();
    log.info('hello', { a: 1 });
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!.line), { time: '2026-01-01T00:00:00.000Z', level: 'info', msg: 'hello', a: 1 });
  });

  it('filtra por nivel', () => {
    const { log, lines } = capture({ level: 'warn' });
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e', new Error('x'));
    assert.deepEqual(lines.map((l) => JSON.parse(l.line).level), ['warn', 'error']);
  });

  it('warn e error vao para o canal de erro; info nao', () => {
    const { log, lines } = capture();
    log.info('i'); log.warn('w'); log.error('e');
    assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'error']);
  });

  it('child herda o contexto e o campo do registro prevalece', () => {
    const { log, lines } = capture();
    log.child({ component: 'socket', k: 1 }).child({ k: 2 }).info('x');
    const rec = JSON.parse(lines[0]!.line);
    assert.equal(rec.component, 'socket');
    assert.equal(rec.k, 2);
  });

  it('error serializa o erro (com stack) e redige campos sensiveis junto', () => {
    const { log, lines } = capture();
    log.error('falhou', new Error('boom'), { password: 'segredo', userId: 'u1' });
    const rec = JSON.parse(lines[0]!.line);
    assert.equal(rec.err.message, 'boom');
    assert.match(rec.err.stack, /Error: boom/);
    assert.equal(rec.password, '[redacted]');
    assert.equal(rec.userId, 'u1');
    assert.equal(lines[0]!.line.includes('segredo'), false);
  });

  it('timer registra a duracao em ms', () => {
    const { log, lines } = capture();
    const done = log.timer('info', 'operacao', { job: 'x' });
    done({ extra: true });
    const rec = JSON.parse(lines[0]!.line);
    assert.equal(rec.msg, 'operacao');
    assert.equal(rec.extra, true);
    assert.equal(typeof rec.ms, 'number');
  });

  it('formato pretty e legivel, numa linha, com componente', () => {
    const { log, lines } = capture({ format: 'pretty' });
    log.child({ component: 'auth' }).warn('login failed', { username: 'ana' });
    assert.match(lines[0]!.line, /WARN\s+\[auth\] login failed \{"username":"ana"\}$/);
  });

  it('um write que lanca nunca derruba quem registra', () => {
    const log = createLogger({ level: 'debug', write: () => { throw new Error('disco cheio'); } });
    assert.doesNotThrow(() => log.error('x', new Error('y')));
  });
});
