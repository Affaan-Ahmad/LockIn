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

/** A user with no `google_connections` row at all. */
function emptyClient(): AppSupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return { from: () => builder } as unknown as AppSupabaseClient;
}

describe('the refresh token state the connection service asks for', () => {
  /**
   * Three answers, because two of them mean "no usable token" for opposite
   * reasons.
   *
   * This was a boolean, and the boolean was the bug. `false` meant both "the
   * student never granted offline access" and "the ciphertext is fine but this
   * deployment's key is wrong", so the connection service read a key mismatch as
   * a missing consent and overwrote the row -- destroying both the working
   * credential's status and the only evidence of what had actually gone wrong.
   */
  it('reports a token this key can open as usable', async () => {
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: null,
        refresh_token_ct: encryptedWith(PROD_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      silentLogger,
    );

    expect(await repo.refreshTokenState(USER_ID)).toBe('USABLE');
  });

  it('reports a NULL column as absent', async () => {
    // The genuine consent problem: reconnecting with offline access fixes it.
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({ access_token_ct: null, refresh_token_ct: null }),
      PROD_KEY,
      silentLogger,
    );

    expect(await repo.refreshTokenState(USER_ID)).toBe('ABSENT');
  });

  it('reports an account with no row at all as absent', async () => {
    const repo = new SupabaseGoogleConnectionRepository(emptyClient(), PROD_KEY, silentLogger);

    expect(await repo.refreshTokenState(USER_ID)).toBe('ABSENT');
  });

  it('reports a ciphertext this key cannot open as unreadable, never as absent', async () => {
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: null,
        refresh_token_ct: encryptedWith(OTHER_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      silentLogger,
    );

    expect(await repo.refreshTokenState(USER_ID)).toBe('UNREADABLE');
  });

  it('does not call another account’s ciphertext usable', async () => {
    // The user id is the AAD. A row copied between accounts fails
    // authentication, which is unreadable -- not a token this user may renew with.
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: null,
        refresh_token_ct: bufferToPgHex(
          encryptSecret('refresh-value', decodeKey(PROD_KEY), 'a-different-user'),
        ),
      }),
      PROD_KEY,
      silentLogger,
    );

    expect(await repo.refreshTokenState(USER_ID)).toBe('UNREADABLE');
  });

  it('logs the code and nothing derived from the credential', async () => {
    const entries: { message: string; fields: LogFields }[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: null,
        refresh_token_ct: encryptedWith(OTHER_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      recordingLogger(entries),
    );

    await repo.refreshTokenState(USER_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fields['errorCode']).toBe('CREDENTIAL_DECRYPTION_FAILED');

    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('refresh-value');
    // Not the ciphertext either: its length is the plaintext's length.
    expect(serialised).not.toContain('\\\\x');
  });

  it('reads the access token column for nothing, and says nothing about it', async () => {
    // Only the refresh token decides durability. Decrypting the access token
    // here would produce a second log line for a credential nobody asked about
    // -- and the caller cannot act on it either way.
    const entries: { message: string; fields: LogFields }[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      stubClient({
        access_token_ct: encryptedWith(OTHER_KEY, 'access-value'),
        refresh_token_ct: encryptedWith(PROD_KEY, 'refresh-value'),
      }),
      PROD_KEY,
      recordingLogger(entries),
    );

    expect(await repo.refreshTokenState(USER_ID)).toBe('USABLE');
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The fence on the refresh write
// ---------------------------------------------------------------------------

interface CapturedUpdate {
  payload: Record<string, unknown>;
  filters: Array<readonly [string, unknown]>;
  returning: string | null;
}

/**
 * Just enough PostgREST to answer an `update(...).eq(...).select(...)`.
 *
 * `rows` is what the statement says it touched, so a test can be the two cases
 * that matter: one row updated, or none because the WHERE clause excluded it.
 */
function updateClient(
  rows: readonly unknown[],
  captured: CapturedUpdate[],
): AppSupabaseClient {
  let current: CapturedUpdate = { payload: {}, filters: [], returning: null };

  const builder = {
    update: (payload: Record<string, unknown>) => {
      current = { payload, filters: [], returning: null };
      captured.push(current);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      current.filters.push([column, value] as const);
      return builder;
    },
    select: (columns: string) => {
      current.returning = columns;
      return Promise.resolve({ data: [...rows], error: null });
    },
  };

  return { from: () => builder } as unknown as AppSupabaseClient;
}

const REFRESH_WRITE = {
  userId: USER_ID,
  accessToken: 'fresh-access-value',
  accessTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
  rotatedRefreshToken: 'rotated-refresh-value',
  grantedScopes: null,
  status: 'ACTIVE' as const,
  errorCode: null,
};

describe('recording a refresh against a row that may have moved on', () => {
  /**
   * The window: the connection is read, a second or two is spent at Google's
   * token endpoint, and only then is the result written. A student who
   * disconnects inside it has their ciphertexts nulled and the row marked
   * REVOKED -- and an unfenced write puts a live access token, a rotated refresh
   * token and status ACTIVE straight back, reconnecting the account with no
   * error anywhere to notice.
   */
  it('carries the status predicate in the statement that writes', async () => {
    const captured: CapturedUpdate[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      updateClient([{ user_id: USER_ID }], captured),
      PROD_KEY,
      silentLogger,
    );

    await repo.recordRefresh(REFRESH_WRITE);

    // Both filters on the one UPDATE. A status read followed by a write would
    // be the same race a step smaller, and `user_id` alone is the bug.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.filters).toEqual([
      ['user_id', USER_ID],
      ['status', 'ACTIVE'],
    ]);
  });

  it('reports the write as won when the statement touched the row', async () => {
    const captured: CapturedUpdate[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      updateClient([{ user_id: USER_ID }], captured),
      PROD_KEY,
      silentLogger,
    );

    expect(await repo.recordRefresh(REFRESH_WRITE)).toBe(true);
  });

  it('reports it as lost when the row was no longer ACTIVE', async () => {
    // Nothing was written, and the caller must not act as though it was.
    const captured: CapturedUpdate[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      updateClient([], captured),
      PROD_KEY,
      silentLogger,
    );

    expect(await repo.recordRefresh(REFRESH_WRITE)).toBe(false);
  });

  it('asks the statement itself how many rows it touched', async () => {
    // RETURNING, not a follow-up count: a second query could see a third state.
    // And only `user_id` comes back -- there is no reason to read a credential
    // out of a write.
    const captured: CapturedUpdate[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      updateClient([{ user_id: USER_ID }], captured),
      PROD_KEY,
      silentLogger,
    );

    await repo.recordRefresh(REFRESH_WRITE);

    expect(captured[0]?.returning).toBe('user_id');
  });

  it('still encrypts what it writes, and writes no plaintext', async () => {
    const captured: CapturedUpdate[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      updateClient([{ user_id: USER_ID }], captured),
      PROD_KEY,
      silentLogger,
    );

    await repo.recordRefresh(REFRESH_WRITE);

    const payload = JSON.stringify(captured[0]?.payload);
    expect(payload).not.toContain('fresh-access-value');
    expect(payload).not.toContain('rotated-refresh-value');
    expect(captured[0]?.payload['status']).toBe('ACTIVE');
  });

  it('omits a rotated token Google did not send, rather than nulling the stored one', async () => {
    // Unchanged by the fence, and the rule the whole method exists around.
    const captured: CapturedUpdate[] = [];
    const repo = new SupabaseGoogleConnectionRepository(
      updateClient([{ user_id: USER_ID }], captured),
      PROD_KEY,
      silentLogger,
    );

    await repo.recordRefresh({ ...REFRESH_WRITE, rotatedRefreshToken: null, grantedScopes: null });

    expect(captured[0]?.payload).not.toHaveProperty('refresh_token_ct');
    expect(captured[0]?.payload).not.toHaveProperty('granted_scopes');
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

// ---------------------------------------------------------------------------
// Asking Google what a token may actually do
// ---------------------------------------------------------------------------

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

function inspectingClient(
  status: number,
  body: unknown,
  captured: CapturedRequest[],
): GoogleOAuthHttpClient {
  const fetchImpl: typeof fetch = (input, init) => {
    const target = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const sent = init?.body;
    captured.push({
      url: target,
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      // The client only ever sends form parameters, and asserting there is no
      // body at all is half the point of these tests.
      body: sent instanceof URLSearchParams ? sent.toString() : null,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };

  return new GoogleOAuthHttpClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    logger: silentLogger,
    fetchImpl,
  });
}

const TOKEN_INFO_OK = {
  scope:
    'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/userinfo.email',
  expires_in: 3599,
  aud: 'ignored',
  sub: 'ignored',
};

describe('tokeninfo transport', () => {
  it('posts with the token in a header and never in the URL', async () => {
    // A URL is the one part of a request that gets written down everywhere:
    // proxy logs, browser history, error reports. Google still accepts
    // `?access_token=`, which is exactly why this has to be asserted.
    const captured: CapturedRequest[] = [];
    await inspectingClient(200, TOKEN_INFO_OK, captured).getTokenInfo('a-live-access-token');

    const request = captured[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://oauth2.googleapis.com/tokeninfo');
    expect(request.url).not.toContain('a-live-access-token');
    expect(request.body).toBeNull();
    expect(request.headers['Authorization']).toBe('Bearer a-live-access-token');
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  it('reports the scopes Google names, including ones we never asked for', async () => {
    const captured: CapturedRequest[] = [];
    const info = await inspectingClient(200, TOKEN_INFO_OK, captured).getTokenInfo('token');

    // Sign-in scopes ride along on the same grant. Filtering them out here
    // would make the stored record of the grant less true than Google's.
    expect(info.scopes).toEqual([
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
    // Google's own expiry, minus a minute of headroom, rather than an hour we
    // assumed on its behalf.
    expect(info.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(info.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3539 * 1000);
  });

  it('refuses a response with no scope information rather than inventing one', async () => {
    const captured: CapturedRequest[] = [];

    await expect(
      inspectingClient(200, { expires_in: 3599 }, captured).getTokenInfo('token'),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
  });

  it('refuses an empty scope string, which cannot describe a live token', async () => {
    const captured: CapturedRequest[] = [];

    await expect(
      inspectingClient(200, { scope: '', expires_in: 3599 }, captured).getTokenInfo('token'),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
  });

  it('refuses a token Google says has already expired', async () => {
    const captured: CapturedRequest[] = [];

    await expect(
      inspectingClient(200, { scope: 'a b', expires_in: 0 }, captured).getTokenInfo('token'),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR' });
  });

  it('never reports a refusal as a lost grant', async () => {
    // AUTHORIZATION_EXPIRED is the code that marks a connection REVOKED and
    // nulls its stored ciphertexts. "Google would not describe this token" is
    // a far weaker claim than "the student withdrew consent", and acting on the
    // stronger one would destroy a working credential.
    const captured: CapturedRequest[] = [];

    await expect(
      inspectingClient(400, { error: 'invalid_token' }, captured).getTokenInfo('token'),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR', retryable: false });
  });

  it('reports an outage as retryable and throttling as rate limiting', async () => {
    const captured: CapturedRequest[] = [];

    await expect(
      inspectingClient(503, { error: 'backend_error' }, captured).getTokenInfo('token'),
    ).rejects.toMatchObject({ code: 'GOOGLE_API_ERROR', retryable: true });

    await expect(
      inspectingClient(429, { error: 'rate_limit_exceeded' }, captured).getTokenInfo('token'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });
});

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
