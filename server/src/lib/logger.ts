// Small structured logger — no dependency, stdout only (Docker/systemd already
// collect it). One JSON line per record in production, a readable line in dev.
// A leaf module: it must not import anything from the rest of the server.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Anything that could be a credential or personal data never reaches a log
// line, whatever the caller passed and however deep it is.
const SENSITIVE_KEY = /pass(word|hash)?|token|cookie|authorization|secret|^code$|codehash|email|apikey|api_key/i;
const MAX_STRING = 1000;
const MAX_DEPTH = 6;

/** Deep copy with sensitive keys replaced, long strings cut and cycles broken. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING}]` : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[max-depth]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(v, depth + 1, seen);
  }
  return out;
}

export function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'NonError', message: typeof err === 'string' ? err : safeStringify(err) };
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(redact(value)) ?? String(value); } catch { return String(value); }
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'json' | 'pretty';
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
}

function defaultOptions(): Required<Pick<LoggerOptions, 'level' | 'format'>> {
  const production = process.env.NODE_ENV === 'production' || (!!process.env.APP_URL && process.env.NODE_ENV !== 'development');
  const level = (process.env.LOG_LEVEL ?? '').toLowerCase();
  const format = (process.env.LOG_FORMAT ?? '').toLowerCase();
  return {
    level: level in ORDER ? (level as LogLevel) : production ? 'info' : 'debug',
    format: format === 'json' || format === 'pretty' ? format : production ? 'json' : 'pretty',
  };
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, err?: unknown, fields?: LogFields): void;
  child(fields: LogFields): Logger;
  /** Returns a function that logs `msg` at `level` with the elapsed `ms`. */
  timer(level: LogLevel, msg: string, fields?: LogFields): (extra?: LogFields) => number;
}

export function createLogger(opts: LoggerOptions = {}, base: LogFields = {}): Logger {
  const defaults = defaultOptions();
  const level = opts.level ?? defaults.level;
  const format = opts.format ?? defaults.format;
  const now = opts.now ?? (() => new Date());
  const write = opts.write ?? ((line, lvl) => { (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(`${line}\n`); });

  function emit(lvl: LogLevel, msg: string, fields?: LogFields, err?: unknown): void {
    if (ORDER[lvl] < ORDER[level]) return;
    const record: Record<string, unknown> = {
      time: now().toISOString(), level: lvl, msg,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
      ...(err !== undefined ? { err: redact(serializeError(err)) } : {}),
    };
    let line: string;
    if (format === 'json') {
      line = JSON.stringify(record);
    } else {
      const { time, level: _l, msg: _m, component, err: e, ...rest } = record;
      const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
      const errText = e ? `\n${(e as { stack?: string; message: string }).stack ?? (e as { message: string }).message}` : '';
      line = `${String(time).slice(11, 23)} ${lvl.toUpperCase().padEnd(5)} ${component ? `[${String(component)}] ` : ''}${msg}${extra}${errText}`;
    }
    try { write(line, lvl); } catch { /* logging must never take the app down */ }
  }

  const self: Logger = {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, err, fields) => emit('error', msg, fields, err),
    child: (fields) => createLogger({ ...opts, level, format }, { ...base, ...fields }),
    timer: (lvl, msg, fields) => {
      const start = process.hrtime.bigint();
      return (extra) => {
        const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
        emit(lvl, msg, { ...fields, ...extra, ms });
        return ms;
      };
    },
  };
  return self;
}

/** The process-wide logger; modules take a child: `const log = logger.child({ component: 'socket' })`. */
export const logger = createLogger();
