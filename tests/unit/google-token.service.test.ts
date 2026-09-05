import { describe, expect, it } from 'vitest';

import type {
  GoogleConnectionRepository,
  GoogleConnectionSnapshot,
  GoogleConnectionStatus,
  GoogleOAuthClient,
  RefreshTokenState,
  RefreshedConnectionWrite,
  RefreshedCredentials,
  StoredGoogleConnection,
  UpsertConnectionInput,
} from '@/application/ports/google-credentials';
import { GoogleTokenService } from '@/application/services/google-token.service';
import { REQUIRED_CLASSROOM_SCOPES } from '@/domain/google/scopes';
import { AuthorizationExpiredError, GoogleApiError } from '@/shared/errors';
import { fixedClock } from '@/shared/clock';
import { silentLogger } from '@/shared/logger';

/**
 * Credential lifecycle.
 *
 * Supabase does not refresh Google provider tokens, so this service is the only
 * thing keeping Classroom access alive. Its failure modes are all
 * user-visible: refuse to refresh and the student sees no data; mark a
 * connection revoked too eagerly and the student is pushed through a consent
 * flow for a five-second outage.
 */

class FakeConnectionRepository implements GoogleConnectionRepository {
  connection: StoredGoogleConnection | null = null;
  statusChanges: Array<{ status: GoogleConnectionStatus; errorCode: string | null }> = [];
  tokenWrites: RefreshedConnectionWrite[] = [];

  findByUserId(): Promise<StoredGoogleConnection | null> {
    return Promise.resolve(this.connection);
  }

  upsert(_input: UpsertConnectionInput): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Mirrors the real repository's two omit-rather-than-null rules, because the
   * assertions below are about exactly those: a null rotated token leaves the
   * stored one alone, and a null scope list leaves the recorded grant alone.
   *
   * And its fence. The real statement carries `status = 'ACTIVE'` in its WHERE
   * clause and reports how many rows it touched, so a row that stopped being
   * ACTIVE while the refresh was in flight is not written to at all. A fake
   * that wrote unconditionally would make the race untestable here, which is
   * the only place it can be tested without a database.
   */
  recordRefresh(input: RefreshedConnectionWrite): Promise<boolean> {
    this.tokenWrites.push(input);
    if (this.connection === null || this.connection.status !== 'ACTIVE') {
      return Promise.resolve(false);
    }

    this.connection = {
      ...this.connection,
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshToken: input.rotatedRefreshToken ?? this.connection.refreshToken,
      grantedScopes: input.grantedScopes ?? this.connection.grantedScopes,
      status: input.status,
      lastErrorCode: input.errorCode,
    };
    return Promise.resolve(true);
  }

  refreshTokenState(): Promise<RefreshTokenState> {
    if (this.connection === null) return Promise.resolve('ABSENT');
    // Unreadable outranks absent: a ciphertext this key cannot open reads as a
    // null token here, and telling the two apart is the whole point of the port.
    if (this.connection.credentialsUnreadable) return Promise.resolve('UNREADABLE');
    return Promise.resolve(this.connection.refreshToken === null ? 'ABSENT' : 'USABLE');
  }

  /**
   * Applied to the stored row, not merely recorded.
   *
   * REVOKED nulls both ciphertexts in the real repository, and the tests about
   * a disconnection landing mid-refresh are about exactly what the row looks
   * like afterwards. A fake that only kept a list would leave that unobservable.
   */
  markStatus(
    _userId: string,
    status: GoogleConnectionStatus,
    errorCode: string | null,
  ): Promise<void> {
    this.statusChanges.push({ status, errorCode });
    if (this.connection !== null) {
      this.connection = {
        ...this.connection,
        status,
        lastErrorCode: errorCode,
        ...(status === 'REVOKED' ? { accessToken: null, refreshToken: null } : {}),
      };
    }
    return Promise.resolve();
  }

  setGoogleUserId(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): Promise<GoogleConnectionSnapshot | null> {
    return Promise.resolve(null);
  }
}

class FakeOAuthClient implements GoogleOAuthClient {
  calls = 0;
  result: RefreshedCredentials | Error = {
    accessToken: 'fresh-token',
    expiresAt: new Date('2026-03-01T13:00:00Z'),
    refreshToken: null,
    scopes: null,
  };
  delayMs = 0;
  /**
   * Runs while the token endpoint is "answering".
   *
   * The window this hook stands in for is the real one: the connection was read
   * before the request to Google and is written after it, and anything the
   * student does in between happens to a row this refresh has already made up
   * its mind about. Deterministic, where sleeping and hoping is not.
   */
  duringRefresh: (() => Promise<void>) | null = null;

  async refreshAccessToken(): Promise<RefreshedCredentials> {
    this.calls += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.duringRefresh !== null) await this.duringRefresh();
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }
}

const NOW = '2026-03-01T12:00:00Z';

function connection(overrides: Partial<StoredGoogleConnection> = {}): StoredGoogleConnection {
  return {
    userId: 'user-1',
    googleSub: 'sub-1',
    googleUserId: null,
    // A complete grant by default. The service refuses to hand out a token for
    // an incomplete one, so anything else here would make every test below a
    // test of the scope gate.
    grantedScopes: [...REQUIRED_CLASSROOM_SCOPES],
    accessToken: 'stored-token',
    accessTokenExpiresAt: new Date('2026-03-01T13:00:00Z'),
    refreshToken: 'stored-refresh',
    status: 'ACTIVE',
    connectedAt: new Date('2026-01-01T00:00:00Z'),
    lastRefreshedAt: null,
    lastErrorCode: null,
    credentialsUnreadable: false,
    ...overrides,
  };
}

function buildService(repo: FakeConnectionRepository, oauth: FakeOAuthClient) {
  return new GoogleTokenService({
    connections: repo,
    oauth,
    logger: silentLogger,
    clock: fixedClock(NOW),
  });
}

describe('token reuse', () => {
  it('returns a stored token that is still comfortably valid', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection();

    await expect(buildService(repo, oauth).getAccessToken('user-1')).resolves.toBe('stored-token');
    expect(oauth.calls).toBe(0);
  });

  it('refreshes a token inside the expiry skew window', async () => {
    // A token expiring in sixty seconds will expire mid-request. Treating it as
    // usable produces a 401 that looks exactly like revoked consent.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({
      accessTokenExpiresAt: new Date('2026-03-01T12:01:00Z'),
    });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).resolves.toBe('fresh-token');
    expect(oauth.calls).toBe(1);
  });

  it('refreshes when the stored expiry is unknown', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).resolves.toBe('fresh-token');
  });
});

describe('refresh token rotation', () => {
  it('persists a rotated refresh token', async () => {
    // Google rotates occasionally. Keeping the old value means the next refresh
    // fails with invalid_grant and the student reconnects for nothing.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    oauth.result = {
      accessToken: 'fresh-token',
      expiresAt: new Date('2026-03-01T13:00:00Z'),
      refreshToken: 'rotated-refresh',
      scopes: null,
    };

    await buildService(repo, oauth).getAccessToken('user-1');

    expect(repo.tokenWrites[0]?.rotatedRefreshToken).toBe('rotated-refresh');
  });

  it('leaves the stored refresh token alone when Google does not send one', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });

    await buildService(repo, oauth).getAccessToken('user-1');

    expect(repo.tokenWrites[0]?.rotatedRefreshToken).toBeNull();
    expect(repo.connection?.refreshToken).toBe('stored-refresh');
  });

  it('records a successful refresh as ACTIVE with no error code', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });

    await buildService(repo, oauth).getAccessToken('user-1');

    expect(repo.tokenWrites[0]).toMatchObject({ status: 'ACTIVE', errorCode: null });
  });
});

describe('failure handling', () => {
  it('marks the connection revoked when Google refuses the grant', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    oauth.result = new AuthorizationExpiredError('invalid_grant');

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
    expect(repo.statusChanges).toContainEqual({ status: 'REVOKED', errorCode: 'INVALID_GRANT' });
  });

  it('does NOT mark the connection broken on a transient failure', async () => {
    // Pushing a student through a consent flow because Google had a bad minute
    // is the wrong trade.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    oauth.result = new GoogleApiError('backend error', { status: 503, retryable: true });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'GOOGLE_API_ERROR',
    });
    expect(repo.statusChanges).toHaveLength(0);
  });

  it('refuses immediately when the connection is already revoked', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ status: 'REVOKED' });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
    expect(oauth.calls).toBe(0);
  });

  it('requires reconnection when no refresh token was ever stored', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null, refreshToken: null });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
    expect(repo.statusChanges).toContainEqual({
      status: 'NEEDS_RECONNECT',
      errorCode: 'NO_REFRESH_TOKEN',
    });
  });

  it('reports a missing connection as an authentication problem', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHENTICATION_ERROR',
    });
  });
});

describe('concurrent refresh', () => {
  it('collapses simultaneous refreshes for one user into a single call', async () => {
    // A sync fanning out over six courses would otherwise fire six refreshes.
    // Google rotates the refresh token on one and invalidates the rest.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    oauth.delayMs = 10;
    repo.connection = connection({ accessTokenExpiresAt: null });

    const service = buildService(repo, oauth);
    const results = await Promise.all([
      service.getAccessToken('user-1'),
      service.getAccessToken('user-1'),
      service.getAccessToken('user-1'),
      service.getAccessToken('user-1'),
    ]);

    expect(oauth.calls).toBe(1);
    expect(results).toEqual(['fresh-token', 'fresh-token', 'fresh-token', 'fresh-token']);
  });

  it('allows a later refresh after the in-flight one settles', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    const service = buildService(repo, oauth);

    await service.getAccessToken('user-1');
    repo.connection = connection({ accessTokenExpiresAt: null });
    await service.getAccessToken('user-1');

    expect(oauth.calls).toBe(2);
  });

  it('does not leave a failed refresh cached', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    oauth.result = new GoogleApiError('boom', { retryable: true });

    const service = buildService(repo, oauth);
    await expect(service.getAccessToken('user-1')).rejects.toThrow();

    oauth.result = {
      accessToken: 'recovered',
      expiresAt: new Date('2026-03-01T13:00:00Z'),
      refreshToken: null,
      scopes: null,
    };
    await expect(service.getAccessToken('user-1')).resolves.toBe('recovered');
  });
});

describe('a disconnection that lands while a refresh is in flight', () => {
  /**
   * The race the write is fenced against.
   *
   * A refresh reads the connection, spends a round trip at Google's token
   * endpoint, and writes afterwards. A student who presses Disconnect in that
   * window has their credentials nulled and the row marked REVOKED -- and the
   * write that arrives next was decided against a row that no longer exists as
   * it was read. Unfenced, it wrote a live access token, any rotated refresh
   * token and status ACTIVE straight back over the top, reconnecting an account
   * the student had just been told was disconnected. Nothing failed, so nothing
   * was logged, and the only way to find out was to notice that syncing carried
   * on working.
   *
   * The fence is `status = 'ACTIVE'` in the UPDATE's own WHERE clause, and the
   * service acts on whether the statement touched a row.
   */
  function disconnectedMidRefresh(rotated: string | null) {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    oauth.result = {
      accessToken: 'fresh-token',
      expiresAt: new Date('2026-03-01T13:00:00Z'),
      refreshToken: rotated,
      scopes: null,
    };

    const service = buildService(repo, oauth);
    oauth.duringRefresh = async () => {
      await service.disconnect('user-1');
    };
    return { repo, oauth, service };
  }

  it('leaves the disconnection exactly as it wrote the row', async () => {
    const { repo, service } = disconnectedMidRefresh(null);

    await expect(service.getAccessToken('user-1')).rejects.toThrow();

    expect(repo.connection).toMatchObject({
      status: 'REVOKED',
      lastErrorCode: 'USER_DISCONNECTED',
      accessToken: null,
      refreshToken: null,
    });
  });

  it('does not restore a rotated refresh token over the cleared row', async () => {
    // The expensive one. A rotated token written back here is a working
    // credential for an account that has been disconnected, and revoking it at
    // Google already happened -- so nothing would ever clear it again.
    const { repo, service } = disconnectedMidRefresh('rotated-refresh');

    await expect(service.getAccessToken('user-1')).rejects.toThrow();

    expect(repo.tokenWrites).toHaveLength(1);
    expect(repo.connection?.refreshToken).toBeNull();
    expect(repo.connection?.accessToken).toBeNull();
  });

  it('hands back no usable token at all', async () => {
    const { service } = disconnectedMidRefresh(null);

    const outcome = await service.getAccessToken('user-1').then(
      (token) => ({ token }),
      (error: unknown) => ({ error }),
    );

    expect(outcome).not.toHaveProperty('token');
    expect(outcome).toMatchObject({ error: expect.objectContaining({ code: 'AUTHORIZATION_EXPIRED' }) });
  });

  it('does not write a status of its own over the disconnection', async () => {
    // Not REVOKED/INVALID_GRANT, which would rewrite the reason the student's
    // own action gave, and not NEEDS_RECONNECT, which would claim a fault that
    // was never diagnosed. The disconnection is the newer decision and it stands.
    const { repo, service } = disconnectedMidRefresh(null);

    await expect(service.getAccessToken('user-1')).rejects.toThrow();

    expect(repo.statusChanges).toEqual([{ status: 'REVOKED', errorCode: 'USER_DISCONNECTED' }]);
  });

  it('reports the change rather than the narrower grant it was about to record', async () => {
    // Both things are true at once: Google returned a short scope list, and the
    // row stopped being ACTIVE. The scope write never landed, so reporting it
    // would describe a NEEDS_RECONNECT nothing wrote -- and would leave the
    // stored grant looking narrowed when it is untouched.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });
    oauth.result = {
      accessToken: 'fresh-token',
      expiresAt: new Date('2026-03-01T13:00:00Z'),
      refreshToken: null,
      scopes: REQUIRED_CLASSROOM_SCOPES.filter((scope) => !scope.includes('topics')),
    };

    const service = buildService(repo, oauth);
    oauth.duringRefresh = async () => {
      await service.disconnect('user-1');
    };

    await expect(service.getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });

    expect(repo.connection?.status).toBe('REVOKED');
    expect(repo.connection?.grantedScopes).toEqual([...REQUIRED_CLASSROOM_SCOPES]);
    expect(repo.statusChanges).toEqual([{ status: 'REVOKED', errorCode: 'USER_DISCONNECTED' }]);
  });

  it('still writes, and still returns the token, when nothing raced it', async () => {
    // The fence must not cost the ordinary path anything.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).resolves.toBe('fresh-token');
    expect(repo.connection).toMatchObject({ status: 'ACTIVE', accessToken: 'fresh-token' });
  });
});

describe('unreadable stored credentials', () => {
  /**
   * The production incident this guards against.
   *
   * A deployment whose GOOGLE_TOKEN_ENCRYPTION_KEY differs from the one the rows
   * were written with cannot decrypt either ciphertext. The repository reports
   * that as `credentialsUnreadable`, and the distinction matters more than it
   * looks: without it both tokens simply read back as null, which is
   * indistinguishable from "Google never issued a refresh token" -- so the
   * service reported NO_REFRESH_TOKEN, pushing whoever was debugging towards the
   * OAuth consent screen while the actual fault sat in the environment.
   */
  it('reports a configuration fault, not a missing grant', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      credentialsUnreadable: true,
    });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    });
  });

  it('leaves the connection untouched so restoring the key restores service', async () => {
    // Marking NEEDS_RECONNECT here would push every student through a consent
    // flow to repair an environment variable, and would keep prompting them
    // after the key was put back -- the stored ciphertext was never damaged.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      credentialsUnreadable: true,
    });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toThrow();

    expect(repo.statusChanges).toHaveLength(0);
  });

  it('never spends a token-endpoint call on a credential it could not read', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      credentialsUnreadable: true,
    });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toThrow();

    expect(oauth.calls).toBe(0);
  });

  it('still reports a genuinely absent refresh token as a reconnect', async () => {
    // The other half of the distinction. A NULL column really does mean the
    // student must grant offline access again.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({
      accessTokenExpiresAt: null,
      refreshToken: null,
      credentialsUnreadable: false,
    });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
    expect(repo.statusChanges).toContainEqual({
      status: 'NEEDS_RECONNECT',
      errorCode: 'NO_REFRESH_TOKEN',
    });
  });
});

describe('a grant that is missing permissions', () => {
  /**
   * Google's consent screen lets a student untick individual permissions, and
   * for a long time this codebase could not see that: the callback wrote the
   * list it had *asked* for into granted_scopes, so a half-granted connection
   * was indistinguishable from a complete one. The sync then failed with a 403
   * from Classroom, which reads like a revoked grant and is fixed by neither
   * retrying nor reconnecting-and-unticking-again.
   */
  const partial = REQUIRED_CLASSROOM_SCOPES.filter(
    (scope) => !scope.includes('student-submissions'),
  );

  it('refuses to hand out a token, without spending a call on Google', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ grantedScopes: partial });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
    expect(oauth.calls).toBe(0);
  });

  it('marks it for reconnection rather than revoking it', async () => {
    // REVOKED nulls the stored ciphertexts. The credential here is real and
    // still works -- it simply does not permit enough -- and a repeat consent
    // usually returns no new refresh token, so destroying this one would turn a
    // recoverable state into a broken account.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ grantedScopes: partial });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toThrow();

    expect(repo.statusChanges).toEqual([
      { status: 'NEEDS_RECONNECT', errorCode: 'INSUFFICIENT_SCOPES' },
    ]);
  });

  describe('when a refresh comes back with a narrower grant', () => {
    /**
     * The stored list said one thing and Google has just said another. The newer
     * answer wins -- but the credential that carried it is real, and everything
     * learned in that exchange has to be written down before the throw.
     *
     * The earlier version of this branch threw first and persisted nothing,
     * which quietly discarded three separate facts: the access token Google had
     * just issued, any rotated refresh token, and the scopes that were the whole
     * reason for the failure. The rotated token is the expensive one to lose --
     * it is the only one that still works, so dropping it turns a permissions
     * problem the student can fix into a connection that fails `invalid_grant`
     * on its next attempt.
     */
    function narrowedRefresh(rotated: string | null) {
      const repo = new FakeConnectionRepository();
      const oauth = new FakeOAuthClient();
      repo.connection = connection({ accessTokenExpiresAt: null });
      oauth.result = {
        accessToken: 'fresh-token',
        expiresAt: new Date('2026-03-01T13:00:00Z'),
        refreshToken: rotated,
        scopes: [...partial],
      };
      return { repo, service: buildService(repo, oauth) };
    }

    it('refuses to hand the token out', async () => {
      const { service } = narrowedRefresh(null);

      await expect(service.getAccessToken('user-1')).rejects.toMatchObject({
        code: 'AUTHORIZATION_EXPIRED',
      });
    });

    it('persists the status and the error code in the same write as the credential', async () => {
      const { repo, service } = narrowedRefresh(null);

      await expect(service.getAccessToken('user-1')).rejects.toThrow();

      expect(repo.tokenWrites).toHaveLength(1);
      expect(repo.tokenWrites[0]).toMatchObject({
        status: 'NEEDS_RECONNECT',
        errorCode: 'INSUFFICIENT_SCOPES',
      });
      // Not a second statement. A separate markStatus call would leave a window
      // in which the row is ACTIVE with permissions it does not hold.
      expect(repo.statusChanges).toHaveLength(0);
    });

    it('persists the access token Google just issued', async () => {
      const { repo, service } = narrowedRefresh(null);

      await expect(service.getAccessToken('user-1')).rejects.toThrow();

      expect(repo.tokenWrites[0]?.accessToken).toBe('fresh-token');
    });

    it('persists the scopes Google actually reported, not the stale stored list', async () => {
      // The connect screen names the missing permissions from this list. Left
      // stale, it would name the wrong ones -- or none.
      const { repo, service } = narrowedRefresh(null);

      await expect(service.getAccessToken('user-1')).rejects.toThrow();

      expect(repo.tokenWrites[0]?.grantedScopes).toEqual([...partial]);
      expect(repo.connection?.grantedScopes).toEqual([...partial]);
    });

    it('preserves a rotated refresh token rather than dropping it with the failure', async () => {
      // The one that would have been lost. Keeping the superseded token means
      // the next refresh fails invalid_grant, and the account is then genuinely
      // broken rather than merely under-permissioned.
      const { repo, service } = narrowedRefresh('rotated-refresh');

      await expect(service.getAccessToken('user-1')).rejects.toThrow();

      expect(repo.tokenWrites[0]?.rotatedRefreshToken).toBe('rotated-refresh');
      expect(repo.connection?.refreshToken).toBe('rotated-refresh');
    });

    it('never marks the connection revoked, which would erase the credential', async () => {
      // REVOKED nulls the stored ciphertexts. A narrowed grant is a live
      // credential with insufficient permissions, and this branch deliberately
      // sits outside the invalid_grant handler so it cannot converge on that.
      const { repo, service } = narrowedRefresh('rotated-refresh');

      await expect(service.getAccessToken('user-1')).rejects.toThrow();

      expect(repo.statusChanges).not.toContainEqual(
        expect.objectContaining({ status: 'REVOKED' }),
      );
      expect(repo.connection?.refreshToken).not.toBeNull();
    });
  });

  it('ignores a refresh response that reports no scopes at all', async () => {
    // Absence is not evidence. Google omits `scope` from some refresh
    // responses, and reading that as "the grant shrank" would disconnect
    // working accounts.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).resolves.toBe('fresh-token');
    expect(repo.statusChanges).toHaveLength(0);
    // Passed through as null so the recorded grant is left alone, rather than
    // being overwritten with an empty list Google never sent.
    expect(repo.tokenWrites[0]?.grantedScopes).toBeNull();
    expect(repo.connection?.grantedScopes).toEqual([...REQUIRED_CLASSROOM_SCOPES]);
  });
});

describe('a connection already needing reconnection', () => {
  it('refuses without reusing a stored token that has not expired yet', async () => {
    // Otherwise a connection we have already declared unusable keeps serving
    // requests until its last access token happens to lapse.
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ status: 'NEEDS_RECONNECT' });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
    expect(oauth.calls).toBe(0);
  });

  it('does not rewrite the status, preserving the code that explains it', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({
      status: 'NEEDS_RECONNECT',
      accessTokenExpiresAt: null,
      lastErrorCode: 'NO_REFRESH_TOKEN',
    });

    await expect(buildService(repo, oauth).getAccessToken('user-1')).rejects.toThrow();

    expect(repo.statusChanges).toHaveLength(0);
  });
});
