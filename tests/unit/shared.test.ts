import { describe, expect, it, vi } from 'vitest';

import {
  isVisibleLifecycle,
  MISSING_STREAK_THRESHOLD,
  onItemMissing,
  onItemSeen,
} from '@/domain/assignment/lifecycle';
import { assessFreshness } from '@/domain/sync/freshness';
import { chunk, mapWithConcurrency } from '@/shared/concurrency';
import { decodeKey, decryptSecret, encryptSecret } from '@/shared/crypto';
import { AuthorizationExpiredError, GoogleApiError, RateLimitError } from '@/shared/errors';
import { stableFingerprint } from '@/shared/hash';
import { createLogger, redact } from '@/shared/logger';
import { withRetry } from '@/shared/retry';

describe('logger redaction', () => {
  it('redacts anything whose key looks like a credential', () => {
    // The failure this prevents is a single debug log line writing a live
    // Google refresh token into a log aggregator that keeps it for a year.
    const output = redact({
      provider_refresh_token: 'secret-value',
      googleAccessToken: 'secret-value',
      Authorization: 'Bearer secret-value',
      client_secret: 'secret-value',
      apiKey: 'secret-value',
      sessionCookie: 'secret-value',
      userId: 'user-1',
    }) as Record<string, unknown>;

    for (const key of [
      'provider_refresh_token',
      'googleAccessToken',
      'Authorization',
      'client_secret',
      'apiKey',
      'sessionCookie',
    ]) {
      expect(output[key]).toBe('[REDACTED]');
    }
    expect(output['userId']).toBe('user-1');
  });

  it('redacts nested credentials', () => {
    const output = redact({ connection: { refresh_token: 'x', status: 'ACTIVE' } }) as {
      connection: Record<string, unknown>;
    };
    expect(output.connection['refresh_token']).toBe('[REDACTED]');
    expect(output.connection['status']).toBe('ACTIVE');
  });

  it('never prints binary, which is how ciphertext would leak length', () => {
    expect(redact(Buffer.from('abc'))).toBe('[binary]');
    expect(redact(new Uint8Array([1, 2, 3]))).toBe('[binary]');
  });

  it('survives a circular structure instead of throwing inside a log call', () => {
    const circular: Record<string, unknown> = { name: 'x' };
    circular['self'] = circular;

    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    expect(() => logger.info('test', circular)).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it('binds child fields onto every entry', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (line) => lines.push(line) }).child({
      syncRunId: 'run-1',
    });
    logger.info('hello', { courseId: 'c1' });

    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry['syncRunId']).toBe('run-1');
    expect(entry['courseId']).toBe('c1');
    expect(entry['msg']).toBe('hello');
  });

  it('respects the level threshold', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', sink: (line) => lines.push(line) });
    logger.debug('ignored');
    logger.info('ignored');
    logger.warn('kept');
    expect(lines).toHaveLength(1);
  });
});

describe('credential encryption', () => {
  const key = decodeKey(Buffer.alloc(32, 7).toString('base64'));

  it('round-trips a token', () => {
    const envelope = encryptSecret('refresh-token-value', key, 'user-1');
    expect(decryptSecret(envelope, key, 'user-1')).toBe('refresh-token-value');
  });

  it('produces different ciphertext each time', () => {
    const a = encryptSecret('same', key, 'user-1');
    const b = encryptSecret('same', key, 'user-1');
    expect(a.equals(b)).toBe(false);
  });

  it('refuses to decrypt a ciphertext bound to another user', () => {
    // The owner is authenticated data, so a row copied between users fails
    // rather than yielding somebody else's live Google credential.
    const envelope = encryptSecret('refresh-token-value', key, 'user-1');
    expect(() => decryptSecret(envelope, key, 'user-2')).toThrow(/failed authentication/i);
  });

  it('detects tampering', () => {
    const envelope = encryptSecret('refresh-token-value', key, 'user-1');
    const last = envelope.length - 1;
    envelope.writeUInt8(envelope.readUInt8(last) ^ 0xff, last);
    expect(() => decryptSecret(envelope, key, 'user-1')).toThrow(/failed authentication/i);
  });

  it('refuses a key of the wrong length', () => {
    expect(() => decodeKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('rejects a truncated envelope', () => {
    expect(() => decryptSecret(Buffer.alloc(4), key, 'user-1')).toThrow(/truncated/i);
  });
});

describe('bounded concurrency', () => {
  it('never exceeds the limit and preserves order', async () => {
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(results.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16,
    ]);
  });

  it('reports a failure without discarding the successes', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, (value) =>
      value === 2 ? Promise.reject(new Error('nope')) : Promise.resolve(value),
    );

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    expect(results[2]?.status).toBe('fulfilled');
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 4, () => Promise.resolve(1))).toEqual([]);
  });

  it('chunks evenly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('retry policy', () => {
  const noSleep = () => Promise.resolve();

  it('retries a retryable failure', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts += 1;
        if (attempts < 3) throw new GoogleApiError('flaky', { retryable: true });
        return Promise.resolve('done');
      },
      { maxAttempts: 5, sleep: noSleep, random: () => 0.5 },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable failure', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts += 1;
          return Promise.reject(new AuthorizationExpiredError('revoked'));
        },
        { maxAttempts: 5, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED' });

    // Retrying revoked consent cannot succeed and risks getting throttled.
    expect(attempts).toBe(1);
  });

  it('honours a server-supplied Retry-After over its own backoff', async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withRetry(
      () => {
        attempts += 1;
        if (attempts === 1) throw new RateLimitError('slow down', { retryAfterMs: 4321 });
        return Promise.resolve('ok');
      },
      {
        maxAttempts: 3,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      },
    );

    expect(delays).toEqual([4321]);
  });

  it('grows the delay exponentially and caps it', async () => {
    const delays: number[] = [];
    await expect(
      withRetry(() => Promise.reject(new GoogleApiError('flaky', { retryable: true })), {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 500,
        random: () => 1,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([100, 200, 400, 500]);
  });

  it('gives up after the attempt ceiling', async () => {
    const fn = vi.fn().mockRejectedValue(new GoogleApiError('flaky', { retryable: true }));
    await expect(withRetry(fn, { maxAttempts: 3, sleep: noSleep })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('lifecycle transitions', () => {
  it('requires consecutive complete listings before concluding removal', () => {
    const first = onItemMissing('ACTIVE', 0, 'COMPLETE');
    expect(first).toEqual({ status: 'SOURCE_MISSING', missingStreak: 1 });

    const second = onItemMissing(first.status, first.missingStreak, 'COMPLETE');
    expect(second.status).toBe('SOURCE_REMOVED');
    expect(MISSING_STREAK_THRESHOLD).toBe(2);
  });

  it('ignores absence from an incomplete listing entirely', () => {
    // Pagination truncation and a partial outage look identical to deletion if
    // you only compare one response against the database.
    expect(onItemMissing('ACTIVE', 0, 'PARTIAL')).toEqual({ status: 'ACTIVE', missingStreak: 0 });
    expect(onItemMissing('ACTIVE', 1, 'FAILED')).toEqual({ status: 'ACTIVE', missingStreak: 1 });
  });

  it('clears the streak when an item reappears', () => {
    expect(onItemSeen('SOURCE_MISSING')).toEqual({ status: 'ACTIVE', missingStreak: 0 });
    expect(onItemSeen('SOURCE_REMOVED')).toEqual({ status: 'ACTIVE', missingStreak: 0 });
  });

  it('leaves an archived item archived', () => {
    expect(onItemSeen('ARCHIVED').status).toBe('ARCHIVED');
    expect(onItemMissing('ARCHIVED', 5, 'COMPLETE').status).toBe('ARCHIVED');
  });

  it('keeps a merely-missing item visible to the student', () => {
    // One bad response must not make coursework disappear from the list.
    expect(isVisibleLifecycle('SOURCE_MISSING')).toBe(true);
    expect(isVisibleLifecycle('SOURCE_REMOVED')).toBe(false);
  });
});

describe('freshness', () => {
  const now = new Date('2026-03-01T12:00:00Z');

  it('reports data synced minutes ago as fresh', () => {
    expect(
      assessFreshness({
        lastSuccessfulSyncAt: new Date('2026-03-01T11:50:00Z'),
        lastAttemptedSyncAt: new Date('2026-03-01T11:50:00Z'),
        lastRunStatus: 'SUCCESS',
        connectionUsable: true,
        now,
      }).level,
    ).toBe('FRESH');
  });

  it('reports day-old data as stale', () => {
    expect(
      assessFreshness({
        lastSuccessfulSyncAt: new Date('2026-02-28T12:00:00Z'),
        lastAttemptedSyncAt: new Date('2026-02-28T12:00:00Z'),
        lastRunStatus: 'SUCCESS',
        connectionUsable: true,
        now,
      }).level,
    ).toBe('STALE');
  });

  it('reports a recent partial run as PARTIAL, not FRESH', () => {
    // Recency does not fix incompleteness: some courses are simply missing.
    expect(
      assessFreshness({
        lastSuccessfulSyncAt: new Date('2026-03-01T11:59:00Z'),
        lastAttemptedSyncAt: new Date('2026-03-01T11:59:00Z'),
        lastRunStatus: 'PARTIAL_SUCCESS',
        connectionUsable: true,
        now,
      }).level,
    ).toBe('PARTIAL');
  });

  it('reports a broken connection as unavailable regardless of age', () => {
    expect(
      assessFreshness({
        lastSuccessfulSyncAt: new Date('2026-03-01T11:59:00Z'),
        lastAttemptedSyncAt: null,
        lastRunStatus: 'SUCCESS',
        connectionUsable: false,
        now,
      }).level,
    ).toBe('UNAVAILABLE');
  });

  it('reports a never-synced account as unavailable', () => {
    expect(
      assessFreshness({
        lastSuccessfulSyncAt: null,
        lastAttemptedSyncAt: null,
        lastRunStatus: null,
        connectionUsable: true,
        now,
      }).level,
    ).toBe('UNAVAILABLE');
  });
});

describe('stableFingerprint', () => {
  it('is stable and order-sensitive', () => {
    expect(stableFingerprint(['a', 'b'])).toBe(stableFingerprint(['a', 'b']));
    expect(stableFingerprint(['a', 'b'])).not.toBe(stableFingerprint(['b', 'a']));
  });

  it('cannot be fooled by concatenation', () => {
    // Length prefixing is why ["ab","c"] and ["a","bc"] differ. Without it a
    // real content change could hash identically and be skipped as unchanged.
    expect(stableFingerprint(['ab', 'c'])).not.toBe(stableFingerprint(['a', 'bc']));
  });

  it('distinguishes null from an empty string', () => {
    expect(stableFingerprint([null])).not.toBe(stableFingerprint(['']));
  });
});
