import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PLATFORM_MAX_DURATION_SECONDS,
  deriveWorkerSecret,
  workerTokenMatches,
} from '@/config/sync-runtime';

/**
 * The facts about the sync routes that no type can hold.
 *
 * Next.js requires `maxDuration` to be a statically analysable literal, so the
 * routes cannot import the constant the worker budgets against. Nothing but a
 * test can stop those two drifting -- and if they drift the wrong way, the
 * worker plans for time the platform will not give it and gets killed holding a
 * lease, which is the exact failure this architecture was built to remove.
 *
 * The order the handler does its checks in is the other. A handler that reaches
 * `server-only`, env validation and Supabase on import cannot be called from a
 * unit test, so the assertion is made against the source. Crude, and still the
 * difference between an ordering that is intended and one that is merely
 * current.
 */

const ROUTES = [
  'src/app/api/sync/route.ts',
  'src/app/api/sync/continue/route.ts',
  'src/app/api/sync/sweep/route.ts',
];

describe('platform duration', () => {
  it.each(ROUTES)('%s declares the ceiling the worker budgets against', (path) => {
    const source = readFileSync(path, 'utf8');
    const match = /export const maxDuration = (\d+)/.exec(source);

    expect(match, `${path} must export maxDuration`).not.toBeNull();
    expect(Number(match?.[1])).toBe(PLATFORM_MAX_DURATION_SECONDS);
  });

  it('is the Hobby ceiling with fluid compute, not the legacy 60s', () => {
    // Verified against Vercel's docs rather than remembered: with fluid compute
    // -- default for projects created after April 2025 -- Hobby allows 300s as
    // both default and maximum. The previous maxDuration = 60 was cutting the
    // available budget by five, not protecting anything.
    expect(PLATFORM_MAX_DURATION_SECONDS).toBe(300);
  });
});

describe('what a sync request does, and in what order', () => {
  /**
   * The rule: identify the caller, refuse a grant that cannot work, and only
   * then spend the rate limit.
   *
   * Limiting first meant an account whose Google grant is missing a Classroom
   * permission spent quota to be told, correctly, which permission to grant --
   * and once the window was exhausted it stopped being told. The same broken
   * connection then got "too many sync requests, try again in N seconds", which
   * names no fix and invites the student to keep pressing the button. The check
   * is a single indexed read of a row the handler needs anyway; the limiter
   * exists to protect the Google quota, and a request that never reaches Google
   * has no quota to protect.
   */
  const source = readFileSync('src/app/api/sync/route.ts', 'utf8');

  it('identifies the caller before reading anything of theirs', () => {
    expect(source.indexOf('await requireUser()')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('context.connections.snapshot(')).toBeGreaterThan(
      source.indexOf('await requireUser()'),
    );
  });

  it('refuses an incomplete grant before spending the rate limit', () => {
    const scopeGate = source.indexOf('assertClassroomScopesGranted(');
    const rateLimit = source.indexOf('await enforceRateLimit(');

    expect(scopeGate).toBeGreaterThanOrEqual(0);
    expect(rateLimit).toBeGreaterThan(scopeGate);
  });

  it('still refuses it before a run is claimed', () => {
    // The older half of the same rule. A run started against a grant that
    // cannot work spends a lease and a run record to record a failure, and
    // shows the student a failed sync instead of the thing that would fix it.
    expect(source.indexOf('context.sync.startOrResume(')).toBeGreaterThan(
      source.indexOf('assertClassroomScopesGranted('),
    );
  });
});

describe('worker authentication', () => {
  it('derives a stable secret that is not the key it came from', () => {
    const key = 'service-role-key-value-not-a-real-one';
    const secret = deriveWorkerSecret(key);

    expect(secret).toBe(deriveWorkerSecret(key));
    expect(secret).not.toContain(key);
    expect(key).not.toContain(secret);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different secret for a different key, so rotation rotates it', () => {
    expect(deriveWorkerSecret('key-a')).not.toBe(deriveWorkerSecret('key-b'));
  });

  it('rejects a missing, short, long or wrong token', () => {
    const secret = deriveWorkerSecret('key-a');

    expect(workerTokenMatches(secret, secret)).toBe(true);
    expect(workerTokenMatches(null, secret)).toBe(false);
    expect(workerTokenMatches('', secret)).toBe(false);
    expect(workerTokenMatches(secret.slice(0, -1), secret)).toBe(false);
    expect(workerTokenMatches(`${secret}0`, secret)).toBe(false);
    expect(workerTokenMatches(deriveWorkerSecret('key-b'), secret)).toBe(false);
  });
});
