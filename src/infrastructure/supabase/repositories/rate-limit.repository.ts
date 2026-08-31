import 'server-only';

import type { RateLimiter } from '@/application/ports/repositories';
import type { Logger } from '@/shared/logger';

import type { AppSupabaseClient } from '../clients';
import { translatePostgrestError } from './shared';

/**
 * Database-backed rate limiting.
 *
 * In-process counters were the cheaper option and the wrong one: they reset on
 * every deploy, and two server instances would each grant a full allowance. The
 * limit protects a shared, quota-metered resource -- our Google project -- so it
 * has to live somewhere shared.
 */
export class SupabaseRateLimiter implements RateLimiter {
  constructor(
    private readonly db: AppSupabaseClient,
    private readonly logger: Logger,
  ) {}

  async consume(
    userId: string,
    bucket: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const { data, error } = await this.db.rpc('app_consume_rate_limit', {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error !== null) {
      // Fail open, deliberately and loudly.
      //
      // This limiter exists to protect a quota, not to enforce authorisation.
      // If the limiter itself is broken, refusing every request would convert a
      // bookkeeping outage into a total outage -- students unable to see their
      // deadlines because a counter table was unreachable. The alarm is the log
      // line and the monitoring built on it, not a denied request.
      this.logger.error('rate limiter unavailable; allowing the request', {
        userId,
        bucket,
        errorCode: error.code ?? 'unknown',
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (data === true) return { allowed: true, retryAfterSeconds: 0 };

    return { allowed: false, retryAfterSeconds: await this.retryAfter(userId, bucket, windowSeconds) };
  }

  private async retryAfter(
    userId: string,
    bucket: string,
    windowSeconds: number,
  ): Promise<number> {
    const { data, error } = await this.db.rpc('app_rate_limit_retry_after', {
      p_user_id: userId,
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
    });

    if (error !== null) {
      throw translatePostgrestError(error, 'rateLimit.retryAfter');
    }

    return data ?? windowSeconds;
  }
}
