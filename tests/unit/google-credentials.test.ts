import { describe, expect, it } from 'vitest';

import { GoogleOAuthHttpClient } from '@/infrastructure/google/oauth';
import type { AppSupabaseClient } from '@/infrastructure/supabase/clients';
import { SupabaseGoogleConnectionRepository } from '@/infrastructure/supabase/repositories/google-connection.repository';
import { bufferToPgHex } from '@/infrastructure/supabase/repositories/shared';
import { decodeKey, encryptSecret } from '@/shared/crypto';
import { silentLogger, type LogFields } from '@/shared/logger';

/**
 * The storage and refresh halves of the Google credential path.
 *
 * Both have a failure mode that is invisible until production and then very
 * expensive: an encryption key that does not match the stored rows, and an
 * OAuth client secret that does not match the registered client. Neither is a
 * problem with the student's Google grant, and the system used to conclude that
 * it was -- in the second case destructively.
 */

// A deployment's key, and the key some other deployment used. Fixed bytes, so
// the test is deterministic and nothing here is a real credential.
const PROD_KEY = Buffer.alloc(32, 0x11).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 0x22).toString('base64');

const USER_ID = '00000000-0000-4000-8000-000000000001';

interface ConnectionRow {
  readonly access_token_ct: string | null;
  readonly refresh_token_ct: string | null;
}

/** Just enough PostgREST to answer `findByUserId`. */
function stubClient(row: ConnectionRow): AppSupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          user_id: USER_ID,
          google_sub: 'sub-1',
          google_user_id: null,
          granted_scopes: [],
          access_token_expires_at: '2099-01-01T00:00:00.000Z',
          status: 'ACTIVE',
          connected_at: '2026-01-01T00:00:00.000Z',
          last_refreshed_at: null,
          last_error_code: null,
          ...row,
        },
        error: null,
      }),
  };
  return { from: () => builder } as unknown as AppSupabaseClient;
}

function encryptedWith(keyBase64: string, plaintext: string): string {
  return bufferToPgHex(encryptSecret(plaintext, decodeKey(keyBase64), USER_ID));
}

/** Captures log fields so the test can assert on the code, never on a value. */
function recordingLogger(entries: { message: string; fields: LogFields }[]) {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message: string, fields?: LogFields) => {
      entries.push({ message, fields: fields ?? {} });
    },
    child: () => logger,
  };
  return logger;
}

describe('credentials encrypted with a different key', () => {
  it('reports them as unreadable rather than as absent', async () => {
    // The whole incident in one assertion. Both ciphertexts are intact and
    // belong to this user; only the key differs. Reading them back as plain
    // nulls made this indistinguishable from a connection that never had a
    // refresh token, which is a completely different remedy.
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: encryptedWith(OTHER_KEY, 'access-value'),
        refresh_token_ct: encryptedWith(OTHER_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      silentLogger,
    );

    const connection = await repo.findByUserId(USER_ID);

    expect(connection?.credentialsUnreadable).toBe(true);
    expect(connection?.accessToken).toBeNull();
    expect(connection?.refreshToken).toBeNull();
  });

  it('reads them normally once the matching key is restored', async () => {
    // Nothing was damaged: the failure is a configuration state, not data loss,
    // and that is what makes "put the key back" a complete fix.
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: encryptedWith(PROD_KEY, 'access-value'),
        refresh_token_ct: encryptedWith(PROD_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      silentLogger,
    );

    const connection = await repo.findByUserId(USER_ID);

    expect(connection?.credentialsUnreadable).toBe(false);
    expect(connection?.refreshToken).toBe('refresh-value');
  });

  it('logs a structured code and no part of the credential', async () => {
    const entries: { message: string; fields: LogFields }[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: encryptedWith(OTHER_KEY, 'access-value'),
        refresh_token_ct: null,
      }),
      PROD_KEY,
      recordingLogger(entries),
    );

    await repo.findByUserId(USER_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fields['errorCode']).toBe('CREDENTIAL_DECRYPTION_FAILED');
    // AES-GCM authentication failed, which is what says "wrong key" rather than
    // "corrupt row" -- the difference between checking the environment and
    // checking the database.
    expect(entries[0]?.fields['reason']).toBe('AUTH_FAILED');

    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('access-value');
    // Not even the ciphertext: its length is the plaintext's length.
    expect(serialised).not.toContain('\\\\x');
  });

  it('treats a genuinely NULL column as absent, not unreadable', async () => {
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({ access_token_ct: null, refresh_token_ct: null }),
      PROD_KEY,
      silentLogger,
    );

    const connection = await repo.findByUserId(USER_ID);

    expect(connection?.credentialsUnreadable).toBe(false);
    expect(connection?.refreshToken).toBeNull();
  });

  it('flags the row when only one of the two ciphertexts fails', async () => {
    // A key rotated between the access-token write and the refresh-token write
    // leaves exactly this. The connection is still unusable and still not the
    // student's fault.
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: encryptedWith(PROD_KEY, 'access-value'),
        refresh_token_ct: encryptedWith(OTHER_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      silentLogger,
    );

    const connection = await repo.findByUserId(USER_ID);

    expect(connection?.credentialsUnreadable).toBe(true);
  });

  it('does not decrypt a ciphertext that belongs to another user', async () => {
    // The user id is the AAD, so a row copied between accounts fails
    // authentication instead of yielding somebody else's live token.
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: bufferToPgHex(
          encryptSecret('access-value', decodeKey(PROD_KEY), 'a-different-user'),
        ),
        refresh_token_ct: null,
      }),
      PROD_KEY,
      silentLogger,
    );

    const connection = await repo.findByUserId(USER_ID);

    expect(connection?.accessToken).toBeNull();
    expect(connection?.credentialsUnreadable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token endpoint error mapping
// ---------------------------------------------------------------------------

function oauthClient(status: number, body: unknown): GoogleOAuthHttpClient {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  return new GoogleOAuthHttpClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    logger: silentLogger,
    fetchImpl,
  });
}

describe('token endpoint errors', () => {
  it('treats invalid_client as our misconfiguration, not a lost grant', async () => {
    // This mapping is load-bearing beyond its wording. The token service marks
    // an AuthorizationExpiredError as REVOKED, and marking REVOKED nulls the
    // stored ciphertexts -- so classifying invalid_client that way let a single
    // mistyped client secret destroy every user's refresh token irreversibly.
    await expect(
      oauthClient(401, {
        error: 'invalid_client',
        error_description: 'The OAuth client was not found.',
      }).refreshAccessToken('stored-refresh'),
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('still treats invalid_grant as a lost grant', async () => {
    await expect(
      oauthClient(400, {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }).refreshAccessToken('stored-refresh'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED' });
  });

  it('reports a throttled token endpoint as retryable', async () => {
    await expect(
      oauthClient(429, { error: 'rate_limit_exceeded' }).refreshAccessToken('stored-refresh'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('reports a Google-side outage as retryable rather than terminal', async () => {
    await expect(
      oauthClient(503, { error: 'backend_error' }).refreshAccessToken('stored-refresh'),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR', retryable: true });
  });
});
