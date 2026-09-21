// Client-side logger. Same shape as the server's (levels, child, fields), plus
// what only a browser needs: a small in-memory buffer used as "breadcrumbs" and a
// throttled report of real problems to the server (POST /api/client-logs), so an
// error on somebody's screen shows up in the same log as the server's. It never
// throws and never logs about its own failures.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const BUFFER_SIZE = 200;
const DEDUPE_MS = 30_000;
const MAX_REPORTS_PER_MINUTE = 10;
const SENSITIVE_KEY = /pass(word)?|token|cookie|authorization|secret|email/i;

export interface LogRecord { time: number; level: LogLevel; message: string; fields?: LogFields }

export interface ClientLogPayload {
  level: 'warn' | 'error';
  message: string;
  stack?: string;
  url?: string;
  route?: string;
  userAgent?: string;
  appVersion?: string;
  context?: LogFields;
  breadcrumbs: string[];
}

export interface LoggerDeps {
  level?: LogLevel;
  send?: (payload: ClientLogPayload) => void;
  print?: (level: LogLevel, message: string, fields?: LogFields) => void;
  now?: () => number;
  route?: () => string;
}

function scrub(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (depth > 3) return '[max-depth]';
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1)]));
}

function defaultSend(payload: ClientLogPayload): void {
  try {
    void fetch('/api/client-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch { /* reporting is best effort */ }
}

function defaultPrint(level: LogLevel, message: string, fields?: LogFields): void {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug;
  if (fields) fn(message, fields); else fn(message);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  /** `report: true` in the fields also sends a warning to the server. */
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
  child(fields: LogFields): Logger;
  /** Last records, newest last — for tests and the error boundary. */
  recent(): readonly LogRecord[];
}

export function createLogger(deps: LoggerDeps = {}, base: LogFields = {}, shared?: { buffer: LogRecord[]; seen: Map<string, number>; reports: number[] }): Logger {
  const state = shared ?? { buffer: [] as LogRecord[], seen: new Map<string, number>(), reports: [] as number[] };
  const dev = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
  const printLevel = deps.level ?? (dev ? 'debug' : 'warn');
  const now = deps.now ?? Date.now;
  const print = deps.print ?? defaultPrint;
  const send = deps.send ?? defaultSend;
  const route = deps.route ?? (() => (typeof location !== 'undefined' ? location.pathname : ''));

  function shouldReport(key: string): boolean {
    const t = now();
    const last = state.seen.get(key);
    if (last !== undefined && t - last < DEDUPE_MS) return false;
    state.reports = state.reports.filter((r) => t - r < 60_000);
    if (state.reports.length >= MAX_REPORTS_PER_MINUTE) return false;
    state.seen.set(key, t);
    if (state.seen.size > 100) state.seen.delete(state.seen.keys().next().value as string);
    state.reports.push(t);
    return true;
  }

  function emit(level: LogLevel, message: string, fields?: LogFields, error?: unknown): void {
    try {
      const merged = scrub({ ...base, ...fields }) as LogFields;
      const errInfo = error instanceof Error ? { name: error.name, message: error.message } : error !== undefined ? { message: String(error) } : undefined;
      const printable = { ...merged, ...(errInfo ? { err: errInfo } : {}) };
      const hasFields = Object.keys(printable).length > 0;
      state.buffer.push({ time: now(), level, message, fields: hasFields ? printable : undefined });
      if (state.buffer.length > BUFFER_SIZE) state.buffer.shift();
      if (ORDER[level] >= ORDER[printLevel]) print(level, message, hasFields ? printable : undefined);

      const wantsReport = level === 'error' || (level === 'warn' && fields?.report === true);
      if (!wantsReport || !shouldReport(`${level}:${message}:${errInfo?.message ?? ''}`)) return;
      const { report: _report, ...context } = merged;
      const crumbs = state.buffer.slice(0, -1).slice(-5).map((r) => `${new Date(r.time).toISOString().slice(11, 19)} ${r.level} ${r.message}`);
      send({
        level: level === 'error' ? 'error' : 'warn', message: errInfo ? `${message}: ${errInfo.message}` : message,
        stack: error instanceof Error ? error.stack : undefined,
        url: typeof location !== 'undefined' ? location.href.split('#')[0]!.split('?')[0] : undefined, route: route(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        appVersion: typeof import.meta !== 'undefined' ? import.meta.env?.MODE : undefined,
        context: Object.keys(context).length ? context : undefined, breadcrumbs: crumbs,
      });
    } catch { /* logging must never break the app */ }
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, e, f) => emit('error', m, f, e),
    child: (fields) => createLogger(deps, { ...base, ...fields }, state),
    recent: () => state.buffer,
  };
}

export const logger = createLogger();

/** Uncaught errors and unhandled promise rejections become `error` records. */
export function installGlobalErrorHandlers(target: Pick<Window, 'addEventListener'> = window, log: Logger = logger): void {
  target.addEventListener('error', (event) => {
    const e = event as ErrorEvent;
    // a benign browser notice, not an application error
    if (/ResizeObserver loop/i.test(e.message)) return;
    log.error('uncaught error', e.error ?? new Error(e.message), { source: e.filename ? e.filename.split('/').pop() : undefined, line: e.lineno });
  });
  target.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    log.error('unhandled promise rejection', reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'non-error rejection'));
  });
}
