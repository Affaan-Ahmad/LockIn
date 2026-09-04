import 'server-only';

import { createHmac } from 'node:crypto';

/**
 * The platform's hard limit for the sync worker, in seconds.
 *
 * Verified against Vercel's current documentation rather than assumed: with
 * fluid compute -- on by default for projects created after 23 April 2025 --
 * Hobby gets 300s as both the default *and* the maximum. The previous
 * `maxDuration = 60` was therefore not a mitigation but a five-fold reduction
 * of the budget the plan already provided.
 *
 * If fluid compute is off for this project the platform ceiling drops to 60s.
 * That does not break anything here: the worker derives its budget from this
 * number, notices it has less time, and hands over sooner. It just does fewer
 * courses per invocation.
 *
 * MUST match the `maxDuration` literal exported by the sync routes. Next.js
 * requires that to be a statically analysable literal, so it cannot import this
 * constant -- `tests/unit/sync-runtime.test.ts` asserts the two agree.
 */
export const PLATFORM_MAX_DURATION_SECONDS = 300;

/**
 * The worker's shared secret, derived rather than configured.
 *
 * A continuation is the server calling itself, so the endpoint needs to
 * authenticate a caller that has no user session. The obvious answer is a new
 * required environment variable -- and the cost of that is a deployment that
 * fails to boot until somebody remembers to set it, for a value nobody chooses
 * meaningfully.
 *
 * Deriving it from the service-role key instead gives the same property (only
 * something holding a server secret can produce it) with nothing new to
 * configure and nothing new to leak. The label pins the derivation to this
 * purpose, so the output is useless anywhere else, and rotating the service-role
 * key rotates this automatically.
 *
 * The derived value never leaves the server and is never logged.
 */
export function deriveWorkerSecret(serviceRoleKey: string): string {
  return createHmac('sha256', serviceRoleKey).update('lockin.sync.worker.v1').digest('hex');
}

/**
 * Constant-time comparison for the worker token.
 *
 * A plain `===` on a secret leaks its prefix through timing to anyone who can
 * make repeated requests, which for a public HTTPS endpoint is everyone.
 */
export function workerTokenMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  if (presented.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < presented.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
