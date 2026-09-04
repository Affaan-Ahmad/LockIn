import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PLATFORM_MAX_DURATION_SECONDS,
  deriveWorkerSecret,
  workerTokenMatches,
} from '@/config/sync-runtime';

/**
 * The two facts about the runtime that cannot be checked by the type system.
 *
 * Next.js requires `maxDuration` to be a statically analysable literal, so the
 * routes cannot import the constant the worker budgets against. Nothing but a
 * test can stop those two drifting -- and if they drift the wrong way, the
 * worker plans for time the platform will not give it and gets killed holding a
 * lease, which is the exact failure this architecture was built to remove.
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
