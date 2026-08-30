import { describe, expect, it } from 'vitest';

import type {
  GoogleConnectionRepository,
  GoogleConnectionSnapshot,
  GoogleConnectionStatus,
  GoogleOAuthClient,
  RefreshedCredentials,
  StoredGoogleConnection,
  UpsertConnectionInput,
} from '@/application/ports/google-credentials';
import { GoogleTokenService } from '@/application/services/google-token.service';
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
  tokenWrites: Array<{ accessToken: string; refreshToken: string | null }> = [];

  findByUserId(): Promise<StoredGoogleConnection | null> {
    return Promise.resolve(this.connection);
  }

  upsert(_input: UpsertConnectionInput): Promise<void> {
    return Promise.resolve();
  }

  updateAccessToken(
    _userId: string,
    accessToken: string,
    expiresAt: Date,
    rotatedRefreshToken: string | null,
  ): Promise<void> {
    this.tokenWrites.push({ accessToken, refreshToken: rotatedRefreshToken });
    if (this.connection !== null) {
      this.connection = {
        ...this.connection,
        accessToken,
        accessTokenExpiresAt: expiresAt,
        refreshToken: rotatedRefreshToken ?? this.connection.refreshToken,
      };
    }
    return Promise.resolve();
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

class FakeOAuthClient implements GoogleOAuthClient {
  calls = 0;
  result: RefreshedCredentials | Error = {
    accessToken: 'fresh-token',
    expiresAt: new Date('2026-03-01T13:00:00Z'),
    refreshToken: null,
    scopes: null,
  };
  delayMs = 0;

  async refreshAccessToken(): Promise<RefreshedCredentials> {
    this.calls += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
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
    grantedScopes: [],
    accessToken: 'stored-token',
    accessTokenExpiresAt: new Date('2026-03-01T13:00:00Z'),
    refreshToken: 'stored-refresh',
    status: 'ACTIVE',
    connectedAt: new Date('2026-01-01T00:00:00Z'),
    lastRefreshedAt: null,
    lastErrorCode: null,
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

    expect(repo.tokenWrites[0]?.refreshToken).toBe('rotated-refresh');
  });

  it('leaves the stored refresh token alone when Google does not send one', async () => {
    const repo = new FakeConnectionRepository();
    const oauth = new FakeOAuthClient();
    repo.connection = connection({ accessTokenExpiresAt: null });

    await buildService(repo, oauth).getAccessToken('user-1');

    expect(repo.tokenWrites[0]?.refreshToken).toBeNull();
    expect(repo.connection?.refreshToken).toBe('stored-refresh');
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
