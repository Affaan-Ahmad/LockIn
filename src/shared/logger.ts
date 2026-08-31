/**
 * Structured JSON logging with mandatory redaction.
 *
 * The redaction pass is not a nicety. Google access tokens and refresh tokens
 * pass through this process, and a single `logger.info('resp', response)` in a
 * debugging session is enough to write a live credential into a log aggregator
 * that retains it for a year. Redaction happens on the way out, unconditionally,
 * so no call site has to remember.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that stamps `fields` onto every subsequent entry. */
  child(fields: LogFields): Logger;
}

/**
 * Matched case-insensitively against object keys. Substring match, so
 * `provider_refresh_token`, `googleAccessToken` and `Authorization` are all caught.
 */
const REDACT_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'authorization',
  'apikey',
  'api_key',
  'credential',
  'cookie',
  'session',
  'jwt',
  'bearer',
  'signature',
  'client_secret',
] as const;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (value === null || value === undefined) return value;

  const primitive = typeof value;
  if (primitive === 'string' || primitive === 'number' || primitive === 'boolean') return value;
  if (primitive === 'bigint') return (value as bigint).toString();
  if (primitive === 'function' || primitive === 'symbol') return `[${primitive}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  // A Buffer of ciphertext has no business in a log line, and printing it would
  // leak length metadata about the plaintext.
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return '[binary]';
  if (value instanceof Uint8Array) return '[binary]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  if (primitive === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shouldRedactKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }

  return '[unserialisable]';
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly base?: LogFields;
  readonly sink?: (line: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const sink = options.sink ?? defaultSink;
  const threshold = LEVEL_ORDER[level];

  const emit = (entry: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[entry] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level: entry,
      msg: message,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
    };
    try {
      sink(JSON.stringify(payload));
    } catch {
      sink(JSON.stringify({ ts: payload.ts, level: entry, msg: message, fields: '[unloggable]' }));
    }
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) =>
      createLogger({
        level,
        base: { ...base, ...fields },
        ...(options.sink === undefined ? {} : { sink: options.sink }),
      }),
      };
}

function defaultSink(line: string): void {
  // eslint-disable-next-line no-console -- the process stdout is the log transport
  console.log(line);
}

/** Discards everything. Used by unit tests that assert on behaviour, not output. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
