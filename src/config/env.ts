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
  SYNC_LEASE_TTL_SECONDS: intFromEnv(900, 60, 7200),
  GOOGLE_MAX_RETRY_ATTEMPTS: intFromEnv(3, 0, 6),
  GOOGLE_REQUEST_TIMEOUT_MS: intFromEnv(20_000, 1_000, 120_000),

  // Rate limits for the two operations that reach Google. Generous enough for
  // real use, tight enough that a held-down button cannot burn the quota.
  SYNC_RATE_LIMIT: intFromEnv(10, 1, 200),
  SYNC_RATE_WINDOW_SECONDS: intFromEnv(600, 30, 86_400),
  DISCOVERY_RATE_LIMIT: intFromEnv(20, 1, 500),
  DISCOVERY_RATE_WINDOW_SECONDS: intFromEnv(600, 30, 86_400),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
