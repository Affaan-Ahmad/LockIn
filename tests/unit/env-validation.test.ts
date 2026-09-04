import { afterEach, describe, expect, it } from 'vitest';

import { getServerEnv, resetServerEnvCacheForTests } from '@/config/env';
import { decodeKey, keyFingerprint } from '@/shared/crypto';

/**
 * Configuration rules that only bite in production.
 *
 * Every value these tests reject is individually well-formed -- a valid URL, a
 * non-empty string, an integer in range. What makes each one wrong is the
 * combination, which is exactly the class of fault that survives review, passes
 * a build, deploys cleanly and then fails in front of a user.
 */

// Structurally valid, deliberately fake. Nothing here is a credential.
const KEY_A = Buffer.alloc(32, 0xa1).toString('base64');
const KEY_B = Buffer.alloc(32, 0xb2).toString('base64');

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
    NEXT_PUBLIC_SITE_URL: 'https://lockinapp.tech',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY_A,
    ...overrides,
  };
}

/** Parses a candidate environment in isolation, without touching the real one. */
function parse(env: Record<string, string>): { ok: boolean; message: string } {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  resetServerEnvCacheForTests();

  try {
    getServerEnv();
    return { ok: true, message: '' };
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : String(caught) };
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    resetServerEnvCacheForTests();
  }
}

afterEach(() => {
  resetServerEnvCacheForTests();
});

describe('a well-formed production environment', () => {
  it('is accepted', () => {
    expect(parse(baseEnv()).ok).toBe(true);
  });

  it('produces the public origin the OAuth redirect is built from', () => {
    // The redirect is `new URL('/auth/callback', NEXT_PUBLIC_SITE_URL)`, so this
    // is the exact string Google must have registered.
    expect(new URL('/auth/callback', 'https://lockinapp.tech').toString()).toBe(
      'https://lockinapp.tech/auth/callback',
    );
  });

  it('tolerates a trailing slash on the site URL', () => {
    expect(parse(baseEnv({ NEXT_PUBLIC_SITE_URL: 'https://lockinapp.tech/' })).ok).toBe(true);
    expect(new URL('/auth/callback', 'https://lockinapp.tech/').toString()).toBe(
      'https://lockinapp.tech/auth/callback',
    );
  });
});

describe('localhost left in a production deployment', () => {
  it('is rejected rather than shipped', () => {
    // The app would look completely healthy and every sign-in would land on a
    // machine the student is not using.
    const result = parse(baseEnv({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/NEXT_PUBLIC_SITE_URL/);
  });

  it('is still allowed outside production', () => {
    expect(parse(baseEnv({ NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).ok).toBe(
      true,
    );
  });

  it('rejects a plain-http public origin in production', () => {
    expect(parse(baseEnv({ NEXT_PUBLIC_SITE_URL: 'http://lockinapp.tech' })).ok).toBe(false);
  });
});

describe('the service role key', () => {
  it('is rejected when it is really the anon key', () => {
    // google_connections has RLS enabled with no policies, so the anon key reads
    // back zero rows with no error -- and the app reports "no Google connection
    // exists" for a student who is plainly connected.
    const result = parse(
      baseEnv({
        SUPABASE_SERVICE_ROLE_KEY: 'anon-key-value',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('is checked outside production too, because a preview can hit real data', () => {
    expect(
      parse(
        baseEnv({
          NODE_ENV: 'development',
          NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
          SUPABASE_SERVICE_ROLE_KEY: 'anon-key-value',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('the retry budget against the request budget', () => {
  it('rejects a timeout that cannot finish inside one sync request', () => {
    // 20s x 4 attempts is 80s of retries inside a request allowed 60s. The
    // platform kills the function first, so the run holds its lease with nothing
    // finalised and the sync appears to stop working for no visible reason.
    const result = parse(
      baseEnv({ GOOGLE_REQUEST_TIMEOUT_MS: '20000', GOOGLE_MAX_RETRY_ATTEMPTS: '3' }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/GOOGLE_REQUEST_TIMEOUT_MS/);
  });

  it('accepts a budget that fits', () => {
    expect(
      parse(baseEnv({ GOOGLE_REQUEST_TIMEOUT_MS: '10000', GOOGLE_MAX_RETRY_ATTEMPTS: '3' })).ok,
    ).toBe(true);
  });
});

describe('missing configuration', () => {
  it('names every missing variable at once, not one per restart', () => {
    const env = baseEnv();
    delete env['SUPABASE_SERVICE_ROLE_KEY'];
    delete env['GOOGLE_OAUTH_CLIENT_SECRET'];

    const result = parse(env);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(result.message).toMatch(/GOOGLE_OAUTH_CLIENT_SECRET/);
  });

  it('rejects an encryption key that is not exactly 32 bytes', () => {
    const result = parse(
      baseEnv({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
  });
});

describe('encryption key fingerprint', () => {
  it('distinguishes two deployments without revealing either key', () => {
    const a = keyFingerprint(decodeKey(KEY_A));
    const b = keyFingerprint(decodeKey(KEY_B));

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    // The whole point: it must not contain, or be, any part of the key.
    expect(KEY_A).not.toContain(a);
    expect(Buffer.from(KEY_A, 'base64').toString('hex')).not.toContain(a);
  });

  it('is stable, so the same key compares equal across restarts', () => {
    expect(keyFingerprint(decodeKey(KEY_A))).toBe(keyFingerprint(decodeKey(KEY_A)));
  });
});
