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

describe('logger — output and buffer', () => {
  it('prints from the configured level up', () => {
    const { log, print } = setup({ level: 'warn' });
    log.debug('d'); log.info('i'); log.warn('w');
    expect(print.mock.calls.map((c) => c[0])).toEqual(['warn']);
  });

  it('keeps everything in the circular buffer (200), even what it does not print', () => {
    const { log } = setup({ level: 'warn' });
    for (let i = 0; i < 250; i++) log.info(`m${i}`);
    expect(log.recent()).toHaveLength(200);
    expect(log.recent()[0]!.message).toBe('m50');
  });

  it('a child inherits the context', () => {
    const { log, print } = setup();
    log.child({ component: 'socket' }).info('hi', { a: 1 });
    expect(print).toHaveBeenCalledWith('info', 'hi', { component: 'socket', a: 1 });
  });

  it('never prints or sends sensitive fields', () => {
    const { log, print, send } = setup();
    log.error('failed', new Error('x'), { password: 'p', token: 't', email: 'a@b.c', ok: 1 });
    const printed = JSON.stringify(print.mock.calls);
    expect(printed).not.toMatch(/"p"|a@b\.c/);
    expect(send.mock.calls[0]![0].context).toEqual({ password: '[redacted]', token: '[redacted]', email: '[redacted]', ok: 1 });
  });
});

describe('logger — sending to the server', () => {
  it('error is sent with the route, error message, stack and the latest breadcrumbs', () => {
    const { log, send } = setup();
    for (let i = 0; i < 8; i++) log.info(`step ${i}`);
    log.error('render error', new Error('boom'));
    const payload = send.mock.calls[0]![0];
    expect(payload).toMatchObject({ level: 'error', message: 'render error: boom', route: '/app/x' });
    expect(payload.stack).toMatch(/boom/);
    expect(payload.breadcrumbs).toHaveLength(5);
    expect(payload.breadcrumbs.at(-1)).toMatch(/step 7/);
  });

  it('plain warn/info are not sent; warn with report:true is', () => {
    const { log, send } = setup();
    log.info('a'); log.warn('b');
    expect(send).not.toHaveBeenCalled();
    log.warn('c', { report: true, code: 'x' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ level: 'warn', context: { code: 'x' } });
    expect(send.mock.calls[0]![0].context).not.toHaveProperty('report');
  });

  it('the same error repeated within 30s counts once, then comes back after', () => {
    const { log, send, advance } = setup();
    for (let i = 0; i < 20; i++) log.error('same', new Error('identical'));
    expect(send).toHaveBeenCalledTimes(1);
    advance(31_000);
    log.error('same', new Error('identical'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('at most 10 sends per minute, even with different errors', () => {
    const { log, send, advance } = setup();
    for (let i = 0; i < 30; i++) log.error(`error ${i}`);
    expect(send).toHaveBeenCalledTimes(10);
    advance(61_000);
    log.error('new');
    expect(send).toHaveBeenCalledTimes(11);
  });

  it('if sending throws, nothing breaks and nothing is logged about it', () => {
    let t = 0;
    const print = vi.fn();
    const log = createLogger({ level: 'debug', send: () => { throw new Error('network'); }, print, now: () => t++ });
    expect(() => log.error('x', new Error('y'))).not.toThrow();
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('installGlobalErrorHandlers', () => {
  function fakeWindow() {
    const handlers = new Map<string, (e: unknown) => void>();
    return { handlers, target: { addEventListener: (type: string, fn: (e: unknown) => void) => { handlers.set(type, fn); } } as Pick<Window, 'addEventListener'> };
  }

  it('uncaught errors and rejected promises become error records', () => {
    const { log, send } = setup();
    const { handlers, target } = fakeWindow();
    installGlobalErrorHandlers(target, log);
    handlers.get('error')!({ message: 'x', error: new Error('kaboom'), filename: 'http://a/b/app.js', lineno: 7 });
    handlers.get('unhandledrejection')!({ reason: new Error('rejected promise') });
    expect(send.mock.calls.map((c) => c[0].message)).toEqual(['uncaught error: kaboom', 'unhandled promise rejection: rejected promise']);
  });

  it('ignores the harmless "ResizeObserver loop" warning', () => {
    const { log, send } = setup();
    const { handlers, target } = fakeWindow();
    installGlobalErrorHandlers(target, log);
    handlers.get('error')!({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    expect(send).not.toHaveBeenCalled();
  });
});
