import { isRetryable, RateLimitError, toAppError } from './errors';
import type { Logger } from './logger';

/**
 * Exponential backoff with full jitter.
 *
 * Deliberately conservative:
 *  - only errors that declared themselves retryable are retried, so a revoked
 *    grant or a validation failure fails on the first attempt;
 *  - a server-supplied Retry-After always wins over our own computed delay;
 *  - the delay is capped, and the attempt count is small, because a background
 *    sync that hammers Google for ten minutes is worse than a sync that fails
 *    and reports why.
 */

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly logger?: Logger;
  readonly operation?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (caught) {
      lastError = caught;
      const error = toAppError(caught);

      if (!isRetryable(error) || attempt === maxAttempts) throw error;

      const serverHint = error instanceof RateLimitError ? error.retryAfterMs : null;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = serverHint ?? Math.round(exponential * (0.5 + random() * 0.5));

      options.logger?.warn('retrying after retryable failure', {
        operation: options.operation ?? 'unknown',
        attempt,
        maxAttempts,
        delayMs,
        errorCode: error.code,
      });

      await sleep(delayMs);
    }
  }

  throw toAppError(lastError);
}
