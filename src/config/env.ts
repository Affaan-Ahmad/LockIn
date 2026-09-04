import 'server-only';

import { z } from 'zod';

import { ConfigError } from '@/shared/errors';

/**
 * Environment is validated once, at first access, and never read via
 * `process.env` anywhere else in the codebase. Two reasons:
 *
 *  1. A missing GOOGLE_TOKEN_ENCRYPTION_KEY must fail loudly at boot, not
 *     silently produce unencrypted-looking ciphertext at 3am during a sync.
 *  2. Keeping the only `process.env` read behind `server-only` makes it a build
 *     error for a client component to pull a secret into the browser bundle.
 */

const base64Key32 = z
  .string()
  .min(1, 'required')
  .refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'must be exactly 32 bytes, base64-encoded (AES-256 key)' },
    );

const intFromEnv = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().min(min).max(max));

/**
 * Hosts that mean "this is not a deployed origin".
 *
 * A production build carrying a localhost site URL is not a subtle fault: every
 * OAuth redirect lands on a machine the student is not using, so sign-in fails
 * for everyone while the app itself looks perfectly healthy.
 */
const NON_PUBLIC_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

function isNonPublicOrigin(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return NON_PUBLIC_HOSTS.has(hostname) || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GOOGLE_TOKEN_ENCRYPTION_KEY: base64Key32,

  SYNC_COURSE_CONCURRENCY: intFromEnv(4, 1, 16),
  /**
   * Seed for how long one course takes, and the ceiling on retrying one.
   *
   * The seed only has to be roughly right: the worker replaces it with the
   * worst duration it has actually observed, so a student with enormous courses
   * converges on their own number within one invocation.
   */
  SYNC_UNIT_ESTIMATE_MS: intFromEnv(12_000, 1_000, 120_000),
  SYNC_MAX_COURSE_ATTEMPTS: intFromEnv(3, 1, 10),
  /**
   * How long a lease survives without a heartbeat.
   *
   * Now that the worker renews it every third of this interval, the TTL is not
   * "how long a sync takes" -- it is "how long after a worker dies before
   * somebody may take over". Short is good: it bounds the recovery delay. It
   * only has to exceed the gap between heartbeats plus a slow round trip.
   *
   * The old 900s was sized as if it had to cover a whole sync, which meant one
   * killed invocation locked the account out for fifteen minutes.
   */
  SYNC_LEASE_TTL_SECONDS: intFromEnv(90, 30, 7200),
  GOOGLE_MAX_RETRY_ATTEMPTS: intFromEnv(3, 0, 6),
  // 10s, not 20s. With three retries the worst case is four attempts, and at
  // 20s that is 80 seconds of waiting inside a request the platform allows 60 --
  // so the default configuration could not survive its own retry policy. These
  // are small JSON reads; 10s is already generous for one.
  GOOGLE_REQUEST_TIMEOUT_MS: intFromEnv(10_000, 1_000, 120_000),

  // Rate limits for the two operations that reach Google. Generous enough for
  // real use, tight enough that a held-down button cannot burn the quota.
  SYNC_RATE_LIMIT: intFromEnv(10, 1, 200),
  SYNC_RATE_WINDOW_SECONDS: intFromEnv(600, 30, 86_400),
  DISCOVERY_RATE_LIMIT: intFromEnv(20, 1, 500),
  DISCOVERY_RATE_WINDOW_SECONDS: intFromEnv(600, 30, 86_400),

  /**
   * Enables the daily recovery sweep. Optional, and the system is correct
   * without it -- the sweep is a floor, not the mechanism.
   *
   * Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations when
   * this is set. Unset, the sweep endpoint refuses every request rather than
   * standing open: an unauthenticated endpoint that resumes other people's
   * syncs is worse than no sweep at all.
   */
  CRON_SECRET: z.string().min(16).optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})
  /**
   * Cross-field rules that only matter once this is a real deployment.
   *
   * Each of these has already been, or would be, a production incident that the
   * per-field checks above cannot see: every value is individually well-formed
   * and the combination is still wrong.
   */
  .superRefine((env, ctx) => {
    // The anon key is designed to be public and is constrained by row-level
    // security. The service role key bypasses RLS entirely. Pasting the first
    // into the second is a common slip and produces a uniquely confusing
    // failure: google_connections denies every role but the service role, so
    // every read of it silently returns no rows, and the app reports "no Google
    // connection exists" for a user who is plainly connected.
    if (env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_SERVICE_ROLE_KEY'],
        message:
          'must not be the same value as NEXT_PUBLIC_SUPABASE_ANON_KEY (the anon key cannot read google_connections)',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    if (isNonPublicOrigin(env.NEXT_PUBLIC_SITE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SITE_URL'],
        message:
          'points at a local host in a production build; it must be the public origin (e.g. https://lockinapp.tech) or every OAuth redirect will fail',
      });
    }

    if (!isHttps(env.NEXT_PUBLIC_SITE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SITE_URL'],
        message: 'must use https in production; it is the OAuth redirect origin',
      });
    }

    if (!isHttps(env.NEXT_PUBLIC_SUPABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SUPABASE_URL'],
        message: 'must use https in production',
      });
    }

    // The retry budget for ONE Google call must fit inside ONE unit of work,
    // not inside the whole run.
    //
    // This is the distinction the old check got wrong. A sync makes many
    // sequential requests -- topics, several coursework pages, several
    // submission pages, a token refresh -- so comparing one call's retry budget
    // against the entire invocation was both too lax (it ignored that a course
    // makes a dozen calls) and, once the run became resumable, the wrong
    // comparison entirely. What actually matters is that a single call cannot
    // consume the slice a whole course is given.
    const worstCallMs = env.GOOGLE_REQUEST_TIMEOUT_MS * (env.GOOGLE_MAX_RETRY_ATTEMPTS + 1);
    if (worstCallMs > env.SYNC_UNIT_ESTIMATE_MS * 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_REQUEST_TIMEOUT_MS'],
        message: `one Google call may consume up to ${String(worstCallMs)}ms after retries, which dwarfs the ${String(env.SYNC_UNIT_ESTIMATE_MS)}ms budgeted for a whole course; lower the timeout or the retry count`,
      });
    }

    // The lease must outlive the gap between heartbeats, or a healthy worker
    // would be declared dead between its own renewals.
    const heartbeatIntervalMs = Math.max(5_000, (env.SYNC_LEASE_TTL_SECONDS * 1000) / 3);
    if (env.SYNC_LEASE_TTL_SECONDS * 1000 < heartbeatIntervalMs * 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SYNC_LEASE_TTL_SECONDS'],
        message: 'must be at least twice the heartbeat interval so one missed renewal is survivable',
      });
    }
  });


export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached !== null) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report every missing variable at once. Reporting them one per restart is
    // how first-time setup becomes a twenty-minute exercise.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(
      `Invalid server environment configuration:\n${issues}\n\nSee .env.example.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test seam. Never called by application code. */
export function resetServerEnvCacheForTests(): void {
  cached = null;
}
