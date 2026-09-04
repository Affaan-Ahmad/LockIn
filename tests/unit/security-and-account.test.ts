import { describe, expect, it } from 'vitest';

import { AccountService } from '@/application/services/account.service';
import { GoogleTokenService } from '@/application/services/google-token.service';
import type {
  GoogleConnectionRepository,
  GoogleConnectionSnapshot,
  GoogleConnectionStatus,
  RefreshedCredentials,
  StoredGoogleConnection,
} from '@/application/ports/google-credentials';
import { fixedClock } from '@/shared/clock';
import { GoogleApiError } from '@/shared/errors';
import { silentLogger } from '@/shared/logger';
import {
  buildContentSecurityPolicy,
  STATIC_SECURITY_HEADERS,
} from '@/shared/security-headers';

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------

describe('content security policy', () => {
  const policy = buildContentSecurityPolicy({
    nonce: 'testnonce',
    isDevelopment: false,
    supabaseOrigin: 'https://example.supabase.co',
  });

  const directive = (name: string): string =>
    policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

  it('denies by default', () => {
    expect(directive('default-src')).toBe("default-src 'self'");
  });

  it('requires a nonce for scripts and never allows unsafe-inline there', () => {
    // Script injection is the attack that matters: LockIn renders titles and
    // descriptions written by teachers. unsafe-inline in script-src would make
    // the whole policy decorative.
    expect(directive('script-src')).toContain("'nonce-testnonce'");
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
  });

  it('never allows eval in production', () => {
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('does allow eval in development, where React Fast Refresh needs it', () => {
    const dev = buildContentSecurityPolicy({
      nonce: 'n',
      isDevelopment: true,
      supabaseOrigin: 'https://example.supabase.co',
    });
    expect(dev).toContain("'unsafe-eval'");
    // ...and must not silently carry that relaxation into production.
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('blocks framing, plugins and base-tag hijacking', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('form-action')).toBe("form-action 'self'");
  });

  it('lets the browser reach Supabase but nothing else', () => {
    expect(directive('connect-src')).toContain('https://example.supabase.co');
    expect(directive('connect-src')).not.toContain('*');
  });

  it('upgrades insecure requests only in production', () => {
    expect(policy).toContain('upgrade-insecure-requests');
    const dev = buildContentSecurityPolicy({
      nonce: 'n',
      isDevelopment: true,
      supabaseOrigin: 'https://x.supabase.co',
    });
    // Would break local http development.
    expect(dev).not.toContain('upgrade-insecure-requests');
  });

  it('carries a distinct nonce per call', () => {
    const a = buildContentSecurityPolicy({ nonce: 'a1', isDevelopment: false, supabaseOrigin: 'https://x' });
    const b = buildContentSecurityPolicy({ nonce: 'b2', isDevelopment: false, supabaseOrigin: 'https://x' });
    expect(a).not.toBe(b);
  });
});

describe('static security headers', () => {
  const byKey = new Map(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it('sets the ones that matter', () => {
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(byKey.get('Strict-Transport-Security')).toContain('max-age=');
  });

  it('does not leak assignment ids through the Referer of outbound links', () => {
    expect(byKey.get('Referrer-Policy')).not.toBe('unsafe-url');
  });
});

// ---------------------------------------------------------------------------
// Disconnect and deletion
// ---------------------------------------------------------------------------

class FakeConnections implements GoogleConnectionRepository {
  connection: StoredGoogleConnection | null = {
    userId: 'u1',
    googleSub: 's',
    googleUserId: null,
    grantedScopes: [],
    accessToken: 'access',
    accessTokenExpiresAt: new Date('2099-01-01'),
    refreshToken: 'refresh',
    status: 'ACTIVE',
    connectedAt: new Date('2026-01-01'),
    lastRefreshedAt: null,
    lastErrorCode: null,
    credentialsUnreadable: false,
  };
  statusChanges: Array<{ status: GoogleConnectionStatus; errorCode: string | null }> = [];

  findByUserId(): Promise<StoredGoogleConnection | null> {
    return Promise.resolve(this.connection);
  }
  upsert(): Promise<void> {
    return Promise.resolve();
  }
  updateAccessToken(): Promise<void> {
    return Promise.resolve();
  }
  markStatus(_u: string, status: GoogleConnectionStatus, errorCode: string | null): Promise<void> {
    this.statusChanges.push({ status, errorCode });
    if (this.connection !== null) {
      this.connection = { ...this.connection, status, accessToken: null, refreshToken: null };
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

class FakeOAuth {
  revoked: string[] = [];
  failRevoke = false;
  refreshAccessToken(): Promise<RefreshedCredentials> {
    return Promise.reject(new Error('not used'));
  }
  revoke(token: string): Promise<void> {
    if (this.failRevoke) return Promise.reject(new GoogleApiError('google down', { retryable: true }));
    this.revoked.push(token);
    return Promise.resolve();
  }
}

function tokenService(connections: FakeConnections, oauth: FakeOAuth) {
  return new GoogleTokenService({
    connections,
    oauth,
    logger: silentLogger,
    clock: fixedClock('2026-08-31T12:00:00Z'),
  });
}

describe('google disconnect', () => {
  it('revokes the refresh token, which invalidates the whole grant', async () => {
    const connections = new FakeConnections();
    const oauth = new FakeOAuth();

    const result = await tokenService(connections, oauth).disconnect('u1');

    // The refresh token, not the access token: revoking it kills every access
    // token derived from it.
    expect(oauth.revoked).toEqual(['refresh']);
    expect(result.revokedAtGoogle).toBe(true);
  });

  it('clears local credentials even when Google refuses', async () => {
    // The student asked to disconnect. Refusing because Google was briefly
    // unreachable would leave them connected against their wishes.
    const connections = new FakeConnections();
    const oauth = new FakeOAuth();
    oauth.failRevoke = true;

    const result = await tokenService(connections, oauth).disconnect('u1');

    expect(result.revokedAtGoogle).toBe(false);
    expect(connections.statusChanges).toContainEqual({
      status: 'REVOKED',
      errorCode: 'USER_DISCONNECTED',
    });
    expect(connections.connection?.refreshToken).toBeNull();
    expect(connections.connection?.accessToken).toBeNull();
  });

  it('is idempotent when there is nothing connected', async () => {
    const connections = new FakeConnections();
    connections.connection = null;
    const oauth = new FakeOAuth();

    await expect(tokenService(connections, oauth).disconnect('u1')).resolves.toEqual({
      revokedAtGoogle: false,
    });
    expect(oauth.revoked).toHaveLength(0);
  });

  it('leaves the connection unusable afterwards', async () => {
    const connections = new FakeConnections();
    const service = tokenService(connections, new FakeOAuth());

    await service.disconnect('u1');

    await expect(service.getAccessToken('u1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
    });
  });
});

describe('account deletion', () => {
  function build(overrides: { failDelete?: boolean; failRevoke?: boolean } = {}) {
    const deleted: string[] = [];
    const disconnected: string[] = [];

    const service = new AccountService({
      logger: silentLogger,
      google: {
        disconnect: (userId) => {
          disconnected.push(userId);
          if (overrides.failRevoke === true) return Promise.reject(new Error('google down'));
          return Promise.resolve({ revokedAtGoogle: true });
        },
      },
      authUsers: {
        deleteUser: (userId) => {
          if (overrides.failDelete === true) return Promise.reject(new Error('db down'));
          deleted.push(userId);
          return Promise.resolve();
        },
      },
    });

    return { service, deleted, disconnected };
  }

  it('revokes Google before deleting the user', async () => {
    // Order is load-bearing: deleting first destroys the refresh token and
    // strands a live grant we can no longer withdraw.
    const order: string[] = [];
    const service = new AccountService({
      logger: silentLogger,
      google: {
        disconnect: () => {
          order.push('revoke');
          return Promise.resolve({ revokedAtGoogle: true });
        },
      },
      authUsers: {
        deleteUser: () => {
          order.push('delete');
          return Promise.resolve();
        },
      },
    });

    await service.deleteAccount('u1');
    expect(order).toEqual(['revoke', 'delete']);
  });

  it('still deletes when Google revocation fails', async () => {
    // Privacy law does not accept "the third party was down" as a reason to
    // keep processing someone's data.
    const { service, deleted } = build({ failRevoke: true });

    const result = await service.deleteAccount('u1');

    expect(deleted).toEqual(['u1']);
    expect(result.googleRevoked).toBe(false);
  });

  it('reports failure plainly when the user could not be deleted', async () => {
    // The account still exists, so the caller must not be shown a success
    // screen over a half-finished delete.
    const { service } = build({ failDelete: true });

    await expect(service.deleteAccount('u1')).rejects.toMatchObject({
      code: 'PERSISTENCE_ERROR',
    });
  });
});
