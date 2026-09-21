import { describe, expect, it, vi } from 'vitest';
import { createLogger, installGlobalErrorHandlers } from '@/shared/lib/logger';
import type { ClientLogPayload } from '@/shared/lib/logger';

function setup(over: { level?: 'debug' | 'warn' } = {}) {
  let t = 1_000_000;
  const send = vi.fn<(p: ClientLogPayload) => void>();
  const print = vi.fn();
  const log = createLogger({ level: over.level ?? 'debug', send, print, now: () => t, route: () => '/app/x' });
  return { log, send, print, advance: (ms: number) => { t += ms; } };
}

describe('logger — saida e buffer', () => {
  it('imprime a partir do nivel configurado', () => {
    const { log, print } = setup({ level: 'warn' });
    log.debug('d'); log.info('i'); log.warn('w');
    expect(print.mock.calls.map((c) => c[0])).toEqual(['warn']);
  });

  it('guarda tudo no buffer circular (200), mesmo o que nao imprime', () => {
    const { log } = setup({ level: 'warn' });
    for (let i = 0; i < 250; i++) log.info(`m${i}`);
    expect(log.recent()).toHaveLength(200);
    expect(log.recent()[0]!.message).toBe('m50');
  });

  it('child herda o contexto', () => {
    const { log, print } = setup();
    log.child({ component: 'socket' }).info('oi', { a: 1 });
    expect(print).toHaveBeenCalledWith('info', 'oi', { component: 'socket', a: 1 });
  });

  it('nunca imprime nem envia campos sensiveis', () => {
    const { log, print, send } = setup();
    log.error('falhou', new Error('x'), { password: 'p', token: 't', email: 'a@b.c', ok: 1 });
    const printed = JSON.stringify(print.mock.calls);
    expect(printed).not.toMatch(/"p"|a@b\.c/);
    expect(send.mock.calls[0]![0].context).toEqual({ password: '[redacted]', token: '[redacted]', email: '[redacted]', ok: 1 });
  });
});

describe('logger — envio ao servidor', () => {
  it('error e enviado com rota, mensagem do erro, stack e os ultimos breadcrumbs', () => {
    const { log, send } = setup();
    for (let i = 0; i < 8; i++) log.info(`passo ${i}`);
    log.error('render error', new Error('boom'));
    const payload = send.mock.calls[0]![0];
    expect(payload).toMatchObject({ level: 'error', message: 'render error: boom', route: '/app/x' });
    expect(payload.stack).toMatch(/boom/);
    expect(payload.breadcrumbs).toHaveLength(5);
    expect(payload.breadcrumbs.at(-1)).toMatch(/passo 7/);
  });

  it('warn/info comuns nao sao enviados; warn com report:true e', () => {
    const { log, send } = setup();
    log.info('a'); log.warn('b');
    expect(send).not.toHaveBeenCalled();
    log.warn('c', { report: true, code: 'x' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ level: 'warn', context: { code: 'x' } });
    expect(send.mock.calls[0]![0].context).not.toHaveProperty('report');
  });

  it('o mesmo erro repetido em 30 s conta uma vez e volta depois', () => {
    const { log, send, advance } = setup();
    for (let i = 0; i < 20; i++) log.error('igual', new Error('mesmo'));
    expect(send).toHaveBeenCalledTimes(1);
    advance(31_000);
    log.error('igual', new Error('mesmo'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('no maximo 10 envios por minuto, mesmo com erros diferentes', () => {
    const { log, send, advance } = setup();
    for (let i = 0; i < 30; i++) log.error(`erro ${i}`);
    expect(send).toHaveBeenCalledTimes(10);
    advance(61_000);
    log.error('novo');
    expect(send).toHaveBeenCalledTimes(11);
  });

  it('se o envio lanca, nada quebra e nada e registrado sobre isso', () => {
    let t = 0;
    const print = vi.fn();
    const log = createLogger({ level: 'debug', send: () => { throw new Error('rede'); }, print, now: () => t++ });
    expect(() => log.error('x', new Error('y'))).not.toThrow();
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('installGlobalErrorHandlers', () => {
  function fakeWindow() {
    const handlers = new Map<string, (e: unknown) => void>();
    return { handlers, target: { addEventListener: (type: string, fn: (e: unknown) => void) => { handlers.set(type, fn); } } as Pick<Window, 'addEventListener'> };
  }

  it('erros nao tratados e promessas rejeitadas viram registros de erro', () => {
    const { log, send } = setup();
    const { handlers, target } = fakeWindow();
    installGlobalErrorHandlers(target, log);
    handlers.get('error')!({ message: 'x', error: new Error('kaboom'), filename: 'http://a/b/app.js', lineno: 7 });
    handlers.get('unhandledrejection')!({ reason: new Error('promessa') });
    expect(send.mock.calls.map((c) => c[0].message)).toEqual(['uncaught error: kaboom', 'unhandled promise rejection: promessa']);
  });

  it('ignora o aviso inofensivo "ResizeObserver loop"', () => {
    const { log, send } = setup();
    const { handlers, target } = fakeWindow();
    installGlobalErrorHandlers(target, log);
    handlers.get('error')!({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    expect(send).not.toHaveBeenCalled();
  });
});
