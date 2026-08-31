import 'server-only';

import { NextResponse } from 'next/server';

import { createUserScopedClient } from '@/infrastructure/supabase/clients';
import {
  AuthenticationError,
  isAppError,
  RateLimitError,
  toAppError,
  type ErrorCode,
} from '@/shared/errors';
import { createLogger } from '@/shared/logger';

/**
 * Route-handler plumbing.
 *
 * Route handlers in this project do three things and nothing else: establish
 * who is calling, delegate to an application service, and translate the result.
 * Business rules never live in `route.ts`, because a rule reachable only through
 * an HTTP handler cannot be unit tested and cannot be reused by the scheduled
 * sync that will exist later.
 */

/**
 * Error codes safe to return verbatim.
 *
 * Everything else becomes a generic INTERNAL_ERROR. An unmapped error message
 * can carry a table name, a constraint name, a column list or part of a query
 * -- useful in a log, not something to hand to a browser.
 */
const CLIENT_SAFE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'AUTHENTICATION_ERROR',
  'AUTHORIZATION_EXPIRED',
  'SYNC_ALREADY_RUNNING',
  'NOT_FOUND',
  'INVALID_INPUT',
  'RATE_LIMITED',
  // Safe and useful to surface: the fix is a config change the operator makes.
  'GOOGLE_API_DISABLED',
]);

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  CONFIG_ERROR: 500,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_EXPIRED: 403,
  GOOGLE_API_ERROR: 502,
  GOOGLE_API_DISABLED: 503,
  RATE_LIMITED: 429,
  EXTERNAL_VALIDATION_ERROR: 502,
  PERSISTENCE_ERROR: 500,
  SYNC_ALREADY_RUNNING: 409,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  UNKNOWN: 500,
};

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string | null;
}

/**
 * Resolves the caller from the Supabase session.
 *
 * Uses `getUser()` rather than `getSession()`: getSession reads the cookie and
 * trusts it, while getUser validates the JWT against the auth server. On a
 * server route the difference is the difference between authentication and a
 * forged cookie.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const db = await createUserScopedClient();
  const { data, error } = await db.auth.getUser();

  if (error !== null || data.user === null) {
    throw new AuthenticationError('Sign-in required');
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Enforces a rate limit, or throws with the wait time attached.
 *
 * Applied to the two endpoints that reach Google. The sync lease already stops
 * two runs overlapping; this stops a hundred running one after another, which
 * is what would actually burn the Google quota.
 */
export async function enforceRateLimit(
  limiter: { consume: (u: string, b: string, l: number, w: number) => Promise<{ allowed: boolean; retryAfterSeconds: number }> },
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await limiter.consume(userId, bucket, limit, windowSeconds);
  if (result.allowed) return;

  throw new RateLimitError(
    `Too many ${bucket} requests. Try again in ${String(result.retryAfterSeconds)} seconds.`,
    { retryAfterMs: result.retryAfterSeconds * 1000 },
  );
}

export function jsonOk<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function jsonError(caught: unknown): NextResponse {
  const error = toAppError(caught);
  const status = STATUS_BY_CODE[error.code];
  const safe = CLIENT_SAFE_CODES.has(error.code);

  // Full detail, including the cause chain, goes to the log. Only the code and
  // a curated message go to the caller.
  createLogger({ base: { component: 'api' } }).error('request failed', {
    ...error.toLogObject(),
  });

  // Tell the client when to come back rather than leaving it to guess, which
  // is how a rate-limited client turns into a retry storm.
  const headers =
    error instanceof RateLimitError && error.retryAfterMs !== null
      ? { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) }
      : undefined;

  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: safe ? error.message : 'The request could not be completed.',
        retryable: error.retryable,
      },
    },
    headers === undefined ? { status } : { status, headers },
  );
}

export async function handleRoute(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (caught) {
    if (!isAppError(caught)) {
      createLogger({ base: { component: 'api' } }).error('unhandled route error', {
        message: caught instanceof Error ? caught.message : 'unknown',
      });
    }
    return jsonError(caught);
  }
}
