import { getServerEnv } from '@/config/env';
import { decodeKey, keyFingerprint } from '@/shared/crypto';
import { createLogger } from '@/shared/logger';

/**
 * Configuration check, run once before this instance serves anything.
 *
 * `getServerEnv()` is lazy: it validates on first access, and the first access
 * only happens inside a request that needs a Supabase client, a credential or
 * the site URL. So a deployment missing SUPABASE_SERVICE_ROLE_KEY went fully
 * live, served the landing page and the legal pages perfectly, and failed only
 * when a signed-in student tried to do something -- the last place anyone looks
 * for a configuration error and the first place it costs a user.
 *
 * Reading it here turns that into a startup failure naming every broken
 * variable at once.
 *
 * Deliberately not wrapped in try/catch. A ConfigError should stop this
 * instance from serving traffic; swallowing it would restore exactly the late,
 * per-request failure this exists to remove.
 */
const env = getServerEnv();

createLogger({ level: env.LOG_LEVEL, base: { service: 'lockin' } }).info('configuration validated', {
  nodeEnv: env.NODE_ENV,
  // Origins only. The full URLs carry no secrets, but the origin is the part
  // that is ever wrong, and it is what a reviewer compares against the Google
  // console and the Supabase dashboard.
  siteOrigin: new URL(env.NEXT_PUBLIC_SITE_URL).origin,
  supabaseOrigin: new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin,
  /*
   * A truncated hash of the encryption key, never any part of the key.
   *
   * This one line answers the question that otherwise has no safe answer:
   * "is this deployment holding the key that encrypted the stored Google
   * credentials?" Compare it across two environments -- if they differ, the
   * stored refresh tokens cannot be decrypted here, and no amount of user
   * reconnecting explains why.
   *
   * Not named `tokenKeyFingerprint`: the logger redacts any field whose name
   * contains "token", which would have replaced this with [REDACTED]. The
   * redactor is right to be blunt; the field name is what gives way.
   */
  encryptionKeyFingerprint: keyFingerprint(decodeKey(env.GOOGLE_TOKEN_ENCRYPTION_KEY)),
  syncLeaseTtlSeconds: env.SYNC_LEASE_TTL_SECONDS,
  syncCourseConcurrency: env.SYNC_COURSE_CONCURRENCY,
  googleRequestTimeoutMs: env.GOOGLE_REQUEST_TIMEOUT_MS,
  googleMaxRetryAttempts: env.GOOGLE_MAX_RETRY_ATTEMPTS,
});
