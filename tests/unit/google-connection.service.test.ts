import { describe, expect, it } from 'vitest';

import type {
  GoogleConnectionRepository,
  GoogleConnectionSnapshot,
  GoogleConnectionStatus,
  GoogleTokenInfo,
  GoogleTokenInspector,
  RefreshTokenState,
  StoredGoogleConnection,
  UpsertConnectionInput,
} from '@/application/ports/google-credentials';
import {
  assertClassroomScopesGranted,
  GoogleConnectionService,
} from '@/application/services/google-connection.service';
import { REQUIRED_CLASSROOM_SCOPES } from '@/domain/google/scopes';
import { ConfigError, GoogleApiError, RateLimitError } from '@/shared/errors';
import { createLogger, silentLogger, type LogFields } from '@/shared/logger';

/**
 * Recording a Google grant truthfully.
 *
 * The bug this replaces was quiet and total: the callback wrote
 * REQUIRED_CLASSROOM_SCOPES into `granted_scopes` because that is what the
 * consent URL requested, so a student who unticked a permission was recorded as
 * having granted it. Every screen that asks "is this account connected?" read
 * that row, said yes, and the first sign of trouble was a sync failing against
 * Google with a 403.
 *
 * Supabase cannot close that gap -- its session says nothing about the grant --
 * so the scopes come from Google, and the failure modes of *that* call are what
 * most of this file is about.
 */

const SIGN_IN_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];

class FakeConnections implements GoogleConnectionRepository {
  upserts: UpsertConnectionInput[] = [];
  statusChanges: Array<{ status: GoogleConnectionStatus; errorCode: string | null }> = [];
  /**
   * What is already on record for this user, as the port reports it.
   *
   * A state rather than a stored credential: deciding whether a connection is
   * durable must not require handing the application layer a long-lived secret.
   * Three states, because "nothing stored" and "stored but undecryptable" are
   * different faults with opposite remedies.
   */
  storedRefreshToken: RefreshTokenState = 'ABSENT';
  refreshTokenChecks = 0;

  findByUserId(): Promise<StoredGoogleConnection | null> {
    return Promise.resolve(null);
  }

  upsert(input: UpsertConnectionInput): Promise<void> {
    this.upserts.push(input);
    return Promise.resolve();
  }

  recordRefresh(): Promise<boolean> {
    return Promise.resolve(true);
  }

  refreshTokenState(): Promise<RefreshTokenState> {
    this.refreshTokenChecks += 1;
    return Promise.resolve(this.storedRefreshToken);
  }

  markStatus(
    _userId: string,
    status: GoogleConnectionStatus,
    errorCode: string | null,
  ): Promise<void> {
    this.statusChanges.push({ status, errorCode });
    return Promise.resolve();
  }

  setGoogleUserId(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): Promise<GoogleConnectionSnapshot | null> {
    return Promise.resolve(null);
  }
}

class FakeInspector implements GoogleTokenInspector {
  calls = 0;
  result: GoogleTokenInfo | Error = {
    scopes: [...REQUIRED_CLASSROOM_SCOPES, ...SIGN_IN_SCOPES],
    expiresAt: new Date('2026-03-01T13:00:00Z'),
  };

  getTokenInfo(): Promise<GoogleTokenInfo> {
    this.calls += 1;
    if (this.result instanceof Error) return Promise.reject(this.result);
    return Promise.resolve(this.result);
  }
}

function buildService(
  connections: FakeConnections,
  inspector: FakeInspector,
  logger = silentLogger,
) {
  return new GoogleConnectionService({ connections, inspector, logger });
}

/** Captures error logs so a test can assert on the code, never on a value. */
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

const GRANT = {
  userId: 'user-1',
  googleSub: 'sub-1',
  accessToken: 'provider-access-token',
  refreshToken: 'provider-refresh-token',
};

describe('a complete grant', () => {
  it('stores it as active, with the scopes Google reported', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(result.kind).toBe('CONNECTED');
    expect(connections.upserts).toHaveLength(1);
    expect(connections.upserts[0]).toMatchObject({
      status: 'ACTIVE',
      errorCode: null,
      // Including the sign-in scopes. The record is of the grant, not of the
      // subset this product happens to use.
      grantedScopes: [...REQUIRED_CLASSROOM_SCOPES, ...SIGN_IN_SCOPES],
      accessTokenExpiresAt: new Date('2026-03-01T13:00:00Z'),
    });
  });

  it('uses Google expiry rather than assuming an hour', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = {
      scopes: [...REQUIRED_CLASSROOM_SCOPES],
      expiresAt: new Date('2026-03-01T12:04:00Z'),
    };

    await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(connections.upserts[0]?.accessTokenExpiresAt).toEqual(new Date('2026-03-01T12:04:00Z'));
  });

  it('passes a missing refresh token through as null rather than as a value', async () => {
    // Google omits it on every consent after the first unless prompt=consent
    // was honoured. Null means "keep what is stored"; writing anything else
    // would destroy the only way to keep the connection alive.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'USABLE';

    await buildService(connections, inspector).storeProviderGrant({
      ...GRANT,
      refreshToken: null,
    });

    expect(connections.upserts[0]?.refreshToken).toBeNull();
  });

  it('does not spend a lookup when the grant carried its own refresh token', async () => {
    // Nothing to establish: this consent is renewable on its own terms.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();

    await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(connections.refreshTokenChecks).toBe(0);
  });

  it('logs the renewability of the grant in a field the redactor keeps', async () => {
    /**
     * Asserted through a real logger, not through captured fields, because the
     * bug this guards against lives in the redactor rather than at the call
     * site. Keys are matched by substring -- `token`, `secret`, `credential` --
     * so the obvious name for this boolean, `hasRefreshToken`, was written out
     * as [REDACTED]: a diagnostic that survived review, type-checking and its
     * own unit test while telling whoever read the line nothing at all.
     *
     * The value is a boolean about the shape of the grant. There is nothing to
     * redact here, and the assertion below is that nothing was.
     */
    const lines: string[] = [];
    const connections = new FakeConnections();
    const inspector = new FakeInspector();

    await new GoogleConnectionService({
      connections,
      inspector,
      logger: createLogger({ sink: (line) => lines.push(line) }),
    }).storeProviderGrant(GRANT);

    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((parsed) => parsed['msg'] === 'google classroom connection stored');

    expect(entry?.['grantCarriedRenewal']).toBe(true);
    expect(entry?.['durable']).toBe(true);
    expect(JSON.stringify(entry)).not.toContain('REDACTED');
    // And still nothing from the credential itself.
    expect(JSON.stringify(entry)).not.toContain('provider-refresh-token');
  });

  it('says the grant carried no renewal when it did not', async () => {
    // The other value, so the field is proved to be a diagnostic rather than a
    // constant: this consent brought nothing, and durability came from the row.
    const lines: string[] = [];
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'USABLE';

    await new GoogleConnectionService({
      connections,
      inspector,
      logger: createLogger({ sink: (line) => lines.push(line) }),
    }).storeProviderGrant({ ...GRANT, refreshToken: null });

    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((parsed) => parsed['msg'] === 'google classroom connection stored');

    expect(entry?.['grantCarriedRenewal']).toBe(false);
    expect(entry?.['durable']).toBe(true);
  });
});

describe('a grant nothing can renew', () => {
  /**
   * Full permissions and no way to keep them.
   *
   * Google returns a refresh token on the first consent and, with
   * prompt=consent, normally on later ones -- but not reliably. A grant that
   * arrives without one, on an account that has none stored, is usable only
   * until its access token expires.
   *
   * Storing that ACTIVE is the worst available outcome: the account reads as
   * connected on every screen and then stops working by itself about an hour
   * later, with no event anybody can point at and nothing in the logs that
   * looks like a failure. NEEDS_RECONNECT at least names the remedy while the
   * student is still on the page that can apply it.
   */
  it('is not stored as an active connection', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'ABSENT';

    const result = await buildService(connections, inspector).storeProviderGrant({
      ...GRANT,
      refreshToken: null,
    });

    expect(result).toEqual({
      kind: 'NO_REFRESH_TOKEN',
      grantedScopes: [...REQUIRED_CLASSROOM_SCOPES, ...SIGN_IN_SCOPES],
    });
    expect(connections.upserts[0]).toMatchObject({
      status: 'NEEDS_RECONNECT',
      errorCode: 'NO_REFRESH_TOKEN',
    });
  });

  it('still records the scopes and the access token truthfully', async () => {
    // Not renewable is not the same as not real. The grant happened, and the
    // row should say what it was.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'ABSENT';

    await buildService(connections, inspector).storeProviderGrant({
      ...GRANT,
      refreshToken: null,
    });

    expect(connections.upserts[0]).toMatchObject({
      accessToken: 'provider-access-token',
      grantedScopes: [...REQUIRED_CLASSROOM_SCOPES, ...SIGN_IN_SCOPES],
    });
  });

  it('stays connected when a repeat consent lands on a stored refresh token', async () => {
    // The case that must keep working. Google omits the refresh token on repeat
    // consents, and refusing those would break reconnection for every account
    // that is already set up correctly.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'USABLE';

    const result = await buildService(connections, inspector).storeProviderGrant({
      ...GRANT,
      refreshToken: null,
    });

    expect(result.kind).toBe('CONNECTED');
    expect(connections.upserts[0]).toMatchObject({ status: 'ACTIVE', errorCode: null });
    // Null, so the stored credential survives the write untouched.
    expect(connections.upserts[0]?.refreshToken).toBeNull();
  });

  it('reports missing permissions rather than renewability when both are wrong', async () => {
    // The student has to redo consent either way, and only one of the two
    // messages names a box they can tick.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'ABSENT';
    inspector.result = { scopes: SIGN_IN_SCOPES, expiresAt: new Date('2026-03-01T13:00:00Z') };

    const result = await buildService(connections, inspector).storeProviderGrant({
      ...GRANT,
      refreshToken: null,
    });

    expect(result.kind).toBe('INCOMPLETE_SCOPES');
    expect(connections.upserts[0]).toMatchObject({
      status: 'NEEDS_RECONNECT',
      errorCode: 'INSUFFICIENT_SCOPES',
    });
  });
});

describe('a stored refresh token this deployment cannot read', () => {
  /**
   * The state that must never be mistaken for a missing one.
   *
   * A ciphertext written with a different GOOGLE_TOKEN_ENCRYPTION_KEY is
   * intact, still belongs to the student, and becomes usable again the moment
   * the right key is restored. Read as "no refresh token stored" it is
   * indistinguishable from a student who never granted offline access -- and
   * the write that follows overwrites the access token, the scopes and the
   * status of a connection that was working, filing NEEDS_RECONNECT against a
   * fault no reconnection can repair. It also erases the evidence: afterwards
   * the row simply looks like an ordinary failed consent.
   *
   * So this branch writes nothing and says so loudly. It is the same rule the
   * token service applies on the read path, and the same rule that keeps
   * `invalid_client` from destroying credentials: our misconfiguration is never
   * a lost grant.
   */
  it('writes nothing at all', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'UNREADABLE';

    await expect(
      buildService(connections, inspector).storeProviderGrant({ ...GRANT, refreshToken: null }),
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' });

    // No credential written, no scopes written, no status touched.
    expect(connections.upserts).toHaveLength(0);
    expect(connections.statusChanges).toHaveLength(0);
  });

  it('is a ConfigError, not a lost grant and not a missing token', async () => {
    // AUTHORIZATION_EXPIRED would push the student through a consent flow to
    // repair an environment variable, and would keep doing so after the key was
    // restored. NO_REFRESH_TOKEN would tell them the same thing more politely.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'UNREADABLE';

    const caught = await buildService(connections, inspector)
      .storeProviderGrant({ ...GRANT, refreshToken: null })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught).toMatchObject({ retryable: false });
  });

  it('logs the code that names the fix, and nothing from the credential', async () => {
    const entries: { message: string; fields: LogFields }[] = [];
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'UNREADABLE';

    await expect(
      buildService(connections, inspector, recordingLogger(entries)).storeProviderGrant({
        ...GRANT,
        refreshToken: null,
      }),
    ).rejects.toBeInstanceOf(ConfigError);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fields['errorCode']).toBe('CREDENTIAL_DECRYPTION_FAILED');

    // The grant's own access token is in scope at the point of the throw, and
    // none of it may reach a log line -- nor may the stored ciphertext, whose
    // length is the stored token's length.
    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('provider-access-token');
    expect(serialised).not.toContain('\\\\x');
  });

  it('never runs the check when the grant carries its own refresh token', async () => {
    // The repair path. A consent that returns a refresh token settles
    // durability by itself and rewrites the row with credentials this key can
    // read, so an unreadable predecessor is not an obstacle to it.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'UNREADABLE';

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(result.kind).toBe('CONNECTED');
    expect(connections.refreshTokenChecks).toBe(0);
    expect(connections.upserts[0]).toMatchObject({ status: 'ACTIVE', errorCode: null });
  });

  it('is decided before the write, not corrected after it', async () => {
    // The check has to happen before the upsert, not as a repair afterwards:
    // once the row is overwritten there is nothing left to tell the operator
    // that the key, rather than the student, was the problem.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    connections.storedRefreshToken = 'UNREADABLE';

    await expect(
      buildService(connections, inspector).storeProviderGrant({ ...GRANT, refreshToken: null }),
    ).rejects.toBeInstanceOf(ConfigError);

    expect(connections.refreshTokenChecks).toBe(1);
    expect(connections.upserts).toHaveLength(0);
  });
});

describe('a partial grant', () => {
  const withoutSubmissions = REQUIRED_CLASSROOM_SCOPES.filter(
    (scope) => !scope.includes('student-submissions'),
  );

  it('is stored truthfully and marked for reconnection', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = {
      scopes: [...withoutSubmissions],
      expiresAt: new Date('2026-03-01T13:00:00Z'),
    };

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(result).toMatchObject({
      kind: 'INCOMPLETE_SCOPES',
      missingScopes: ['https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'],
    });
    expect(connections.upserts[0]).toMatchObject({
      status: 'NEEDS_RECONNECT',
      errorCode: 'INSUFFICIENT_SCOPES',
      grantedScopes: [...withoutSubmissions],
    });
  });

  it('never passes through a state in which it looks active', async () => {
    // The status and the scopes are the same fact and are written together.
    // Storing ACTIVE and correcting it afterwards leaves a window where a
    // half-granted connection reads as a working one -- permanently, if the
    // correcting write is the one that fails.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = {
      scopes: [...withoutSubmissions],
      expiresAt: new Date('2026-03-01T13:00:00Z'),
    };

    await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(connections.upserts).toHaveLength(1);
    expect(connections.statusChanges).toHaveLength(0);
  });

  it('keeps the credential, because reconnecting reuses the same row', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = {
      scopes: [...withoutSubmissions],
      expiresAt: new Date('2026-03-01T13:00:00Z'),
    };

    await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(connections.upserts[0]?.accessToken).toBe('provider-access-token');
    expect(connections.upserts[0]?.refreshToken).toBe('provider-refresh-token');
  });

  it('treats a grant with no Classroom permissions at all the same way', async () => {
    // Signing in with Google and granting nothing else is a normal thing to do
    // by accident, and it must not read as a connection.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = { scopes: SIGN_IN_SCOPES, expiresAt: new Date('2026-03-01T13:00:00Z') };

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(result.kind).toBe('INCOMPLETE_SCOPES');
    expect(connections.upserts[0]?.status).toBe('NEEDS_RECONNECT');
  });
});

describe('when the grant cannot be verified', () => {
  /**
   * The dangerous branch. An outage says nothing about the student's consent,
   * so every tempting shortcut here is wrong: assuming the full grant is the
   * original bug, marking the connection revoked destroys a working credential,
   * and writing a placeholder row overwrites one that may be perfectly good.
   */
  it('writes nothing at all when Google is unreachable', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = new GoogleApiError('network failure', { retryable: true });

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(result).toEqual({ kind: 'UNVERIFIED' });
    expect(connections.upserts).toHaveLength(0);
    expect(connections.statusChanges).toHaveLength(0);
  });

  it('writes nothing for a malformed response either', async () => {
    // What `googleTokenInfoSchema.safeParse` failing produces: a 200 whose body
    // is not a tokeninfo payload. Unparseable is not "granted nothing".
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = new GoogleApiError('unexpected payload', { retryable: false });

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    // The same outcome as an outage, deliberately: nothing was learned about the
    // grant either way, and nothing was written either way.
    expect(result).toEqual({ kind: 'UNVERIFIED' });
    expect(connections.upserts).toHaveLength(0);
  });

  it('writes nothing when Google answers 4xx', async () => {
    // The shape `translateTokenInfoError` produces for a 400/401/403: a
    // non-retryable GoogleApiError, deliberately never AuthorizationExpiredError.
    // "Google would not describe this token" is a far weaker claim than "the
    // student withdrew consent", and only the second may touch a credential.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = new GoogleApiError('Google would not describe this access token', {
      status: 400,
      retryable: false,
    });

    const result = await buildService(connections, inspector).storeProviderGrant(GRANT);

    expect(result).toEqual({ kind: 'UNVERIFIED' });
    expect(connections.upserts).toHaveLength(0);
    expect(connections.statusChanges).toHaveLength(0);
  });

  it('does not consult the stored credential at all when it cannot verify', async () => {
    // Nothing is written, so nothing needs to be established about durability.
    // A lookup here would be a pointless read on the OAuth callback's hot path.
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = new GoogleApiError('network failure', { retryable: true });

    await buildService(connections, inspector).storeProviderGrant({
      ...GRANT,
      refreshToken: null,
    });

    expect(connections.refreshTokenChecks).toBe(0);
  });

  it('treats throttling as one more way of not having asked', async () => {
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = new RateLimitError('slow down');

    await expect(
      buildService(connections, inspector).storeProviderGrant(GRANT),
    ).resolves.toEqual({ kind: 'UNVERIFIED' });
  });

  it('records whether the failure was transient in the log, where it is read', async () => {
    // The outcome does not carry it: every way of failing to reach Google leads
    // to the same screen and the same advice, so a flag on the result would be a
    // distinction the student never sees. An operator reading the line does want
    // it, and this is the only place it goes.
    const lines: string[] = [];
    const connections = new FakeConnections();
    const inspector = new FakeInspector();
    inspector.result = new GoogleApiError('network failure', { retryable: true });

    await new GoogleConnectionService({
      connections,
      inspector,
      logger: createLogger({ level: 'debug', sink: (line) => lines.push(line) }),
    }).storeProviderGrant(GRANT);

    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((parsed) => parsed['msg'] === 'could not verify the google grant; connection not written');

    expect(entry?.['retryable']).toBe(true);
    expect(entry?.['errorCode']).toBe('GOOGLE_API_ERROR');
  });
});

describe('gating a sync on the stored grant', () => {
  it('refuses one that is missing a permission', () => {
    expect(() =>
      assertClassroomScopesGranted({
        grantedScopes: REQUIRED_CLASSROOM_SCOPES.filter((scope) => !scope.includes('topics')),
      }),
    ).toThrow(/permissions/i);
  });

  it('allows a complete grant, extra scopes and all', () => {
    expect(() =>
      assertClassroomScopesGranted({
        grantedScopes: [...REQUIRED_CLASSROOM_SCOPES, 'https://example.invalid/some.future.scope'],
      }),
    ).not.toThrow();
  });

  it('says nothing about an account that has never connected', () => {
    // A different fault with a different screen. Reporting it here would send
    // somebody who never connected to a page about missing permissions.
    expect(() => assertClassroomScopesGranted(null)).not.toThrow();
  });
});
