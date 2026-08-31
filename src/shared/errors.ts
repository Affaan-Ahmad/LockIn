/**
 * A single error taxonomy for the whole backend.
 *
 * Two properties drive behaviour elsewhere and are therefore part of the type,
 * not conventions:
 *
 *  - `retryable` decides whether the retry helper may try again. Retrying a
 *    revoked OAuth grant is not merely useless, it is how an app gets its
 *    Google project rate-limited.
 *  - `code` is a stable string safe to send to a client. `message` may contain
 *    operational detail and is only ever logged or returned for codes we have
 *    explicitly whitelisted as safe.
 */

export type ErrorCode =
  | 'CONFIG_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_EXPIRED'
  | 'GOOGLE_API_ERROR'
  | 'GOOGLE_API_DISABLED'
  | 'RATE_LIMITED'
  | 'EXTERNAL_VALIDATION_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'SYNC_ALREADY_RUNNING'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNKNOWN';

export interface ErrorContext {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly retryable: boolean;

  readonly context: ErrorContext;

  constructor(message: string, options?: { cause?: unknown; context?: ErrorContext }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.context = options?.context ?? {};
    Error.captureStackTrace?.(this, new.target);
  }

  /** Shape that is safe to serialise into logs. Never includes credentials. */
  toLogObject(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
      message: this.message,
      context: this.context,
      cause: describeCause(this.cause),
    };
  }
}

export class ConfigError extends AppError {
  readonly code = 'CONFIG_ERROR' as const;
  readonly retryable = false;
}

/** The caller is not a signed-in user of *our* application. */
export class AuthenticationError extends AppError {
  readonly code = 'AUTHENTICATION_ERROR' as const;
  readonly retryable = false;
}

/**
 * We are signed in, but our authorisation to call Google on the user's behalf is
 * gone (consent revoked, refresh token invalidated, scopes removed). Only a
 * fresh consent flow fixes this, so it must never be retried.
 */
export class AuthorizationExpiredError extends AppError {
  readonly code = 'AUTHORIZATION_EXPIRED' as const;
  readonly retryable = false;
}

export class GoogleApiError extends AppError {
  readonly code = 'GOOGLE_API_ERROR' as const;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      retryable?: boolean;
      cause?: unknown;
      context?: ErrorContext;
    } = {},
    ) {
    super(message, options);
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }

  override toLogObject(): Record<string, unknown> {
    return { ...super.toLogObject(), status: this.status };
  }
}

/**
 * The Google API itself is not enabled on the Cloud project.
 *
 * Arrives as a 403 and is easily mistaken for a scope or consent problem, which
 * sends whoever is debugging to re-check the consent screen when the actual fix
 * is one click in Cloud Console. Given its own code so the message can say so.
 *
 * Not retryable: enabling an API is a human action, and retrying in a loop
 * would just burn quota against a service that is switched off.
 */
export class GoogleApiDisabledError extends AppError {
  readonly code = 'GOOGLE_API_DISABLED' as const;
  readonly retryable = false;
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly retryable = true;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options: { retryAfterMs?: number | null; cause?: unknown; context?: ErrorContext } = {},
    ) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  override toLogObject(): Record<string, unknown> {
    return { ...super.toLogObject(), retryAfterMs: this.retryAfterMs };
  }
}

/**
 * External data did not match the shape we validated against. This is never
 * retryable: the same request returns the same malformed body.
 */
export class ExternalValidationError extends AppError {
  readonly code = 'EXTERNAL_VALIDATION_ERROR' as const;
  readonly retryable = false;
}

export class PersistenceError extends AppError {
  readonly code = 'PERSISTENCE_ERROR' as const;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { retryable?: boolean; cause?: unknown; context?: ErrorContext } = {},
    ) {
    super(message, options);
    this.retryable = options.retryable ?? false;
  }
}

export class SyncAlreadyRunningError extends AppError {
  readonly code = 'SYNC_ALREADY_RUNNING' as const;
  readonly retryable = false;
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly retryable = false;
}

export class InvalidInputError extends AppError {
  readonly code = 'INVALID_INPUT' as const;
  readonly retryable = false;
}

export class UnknownError extends AppError {
  readonly code = 'UNKNOWN' as const;
  readonly retryable = false;
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function isRetryable(value: unknown): boolean {
  return isAppError(value) && value.retryable;
}

/** Wrap anything thrown into the taxonomy without losing the original cause. */
export function toAppError(value: unknown, fallbackMessage = 'Unexpected error'): AppError {
  if (isAppError(value)) return value;
  const message = value instanceof Error ? value.message : fallbackMessage;
  return new UnknownError(message, { cause: value });
}

function describeCause(cause: unknown): unknown {
  if (cause === undefined || cause === null) return undefined;
  if (isAppError(cause)) return cause.toLogObject();
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  return typeof cause === 'object' ? '[unserialisable cause]' : cause;
}
