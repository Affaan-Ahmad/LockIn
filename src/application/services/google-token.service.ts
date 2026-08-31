import type {
  GoogleConnectionRepository,
  GoogleCredentialProvider,
  GoogleOAuthClient,
} from '@/application/ports/google-credentials';
import type { Clock } from '@/shared/clock';
import { AuthorizationExpiredError, AuthenticationError, isAppError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

/**
 * The single owner of Google credential lifecycle.
 *
 * Supabase Auth does not refresh Google provider tokens. It surfaces
 * `provider_token` and `provider_refresh_token` once, in the session created at
 * the OAuth callback, and then forgets them. An application that assumes
 * otherwise works perfectly during development and stops working an hour after
 * the first real user signs in.
 *
 * So this service exists, and it is the *only* place that:
 *   - reads a stored refresh token,
 *   - decides whether an access token is still usable,
 *   - calls Google's token endpoint,
 *   - persists a rotated credential,
 *   - decides that consent is gone and a reconnect is required.
 *
 * Callers receive `GoogleCredentialProvider`, whose single method hands back an
 * access token. They cannot see the refresh token, cannot see expiry, and
 * cannot write. Duplicated refresh logic -- the usual source of token races and
 * of tokens ending up in log lines -- has nowhere to appear.
 */

/**
 * Refresh this long before the recorded expiry. Covers clock skew between our
 * host and Google's, plus the flight time of a request that starts just before
 * the boundary.
 */
const EXPIRY_SKEW_MS = 120_000;

export interface GoogleTokenServiceOptions {
  readonly connections: GoogleConnectionRepository;
  readonly oauth: GoogleOAuthClient;
  readonly logger: Logger;
  readonly clock: Clock;
}

export class GoogleTokenService implements GoogleCredentialProvider {
  private readonly connections: GoogleConnectionRepository;
  private readonly oauth: GoogleOAuthClient;
  private readonly logger: Logger;
  private readonly clock: Clock;

  /**
   * Collapses concurrent refreshes for the same user into one request.
   *
   * Without this, a sync fanning out over six courses can fire six refreshes
   * for the same expired token. Google would rotate the refresh token on one of
   * them and invalidate the rest, and the user would be told to reconnect for
   * no reason.
   */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(options: GoogleTokenServiceOptions) {
    this.connections = options.connections;
    this.oauth = options.oauth;
    this.logger = options.logger;
    this.clock = options.clock;
  }

  async getAccessToken(userId: string): Promise<string> {
    const existing = this.inFlight.get(userId);
    if (existing !== undefined) return existing;

    const pending = this.resolveAccessToken(userId).finally(() => {
      this.inFlight.delete(userId);
    });
    this.inFlight.set(userId, pending);
    return pending;
  }

  /**
   * Withdraws our access to the student's Google account.
   *
   * Revokes at Google first, then clears locally. Order matters: clearing first
   * would leave a live grant on Google's side that we can no longer address,
   * because revocation needs the very token we just deleted.
   *
   * A failed revocation does not abort the local cleanup. The student asked to
   * disconnect, and refusing because Google was briefly unreachable would leave
   * them connected against their wishes. The failure is logged so the orphaned
   * grant is discoverable, and the student can also revoke it from their Google
   * account page.
   *
   * Idempotent: disconnecting an account that is already disconnected is a
   * no-op, not an error.
   */
  async disconnect(userId: string): Promise<{ revokedAtGoogle: boolean }> {
    const connection = await this.connections.findByUserId(userId);
    if (connection === null) return { revokedAtGoogle: false };

    let revokedAtGoogle = false;

    // Prefer the refresh token: revoking it invalidates the whole grant,
    // including every access token derived from it.
    const token = connection.refreshToken ?? connection.accessToken;
    if (token !== null) {
      try {
        await this.oauth.revoke(token);
        revokedAtGoogle = true;
      } catch (caught) {
        this.logger.warn('google revocation failed; clearing local credentials anyway', {
          userId,
          errorCode: isAppError(caught) ? caught.code : 'UNKNOWN',
        });
      }
    }

    // markStatus('REVOKED') also nulls the stored ciphertexts, so nothing
    // usable survives locally whether or not Google accepted the revocation.
    await this.connections.markStatus(userId, 'REVOKED', 'USER_DISCONNECTED');

    this.logger.info('google connection disconnected by user', { userId, revokedAtGoogle });
    return { revokedAtGoogle };
  }

  private async resolveAccessToken(userId: string): Promise<string> {
    const connection = await this.connections.findByUserId(userId);

    if (connection === null) {
      throw new AuthenticationError('No Google Classroom connection exists for this user', {
        context: { userId },
      });
    }

    if (connection.status === 'REVOKED') {
      throw new AuthorizationExpiredError(
        'Google Classroom access was revoked; the student must reconnect',
        { context: { userId } },
      );
    }

    if (this.isUsable(connection.accessToken, connection.accessTokenExpiresAt)) {
      return connection.accessToken as string;
    }

    if (connection.refreshToken === null) {
      // Without a refresh token there is no path back to a working credential.
      // This happens when Google was not asked for offline access, or when a
      // prior consent was reused without prompt=consent.
      await this.connections.markStatus(userId, 'NEEDS_RECONNECT', 'NO_REFRESH_TOKEN');
      throw new AuthorizationExpiredError(
        'No Google refresh token is stored; the student must reconnect with offline access',
        { context: { userId } },
      );
    }

    return this.refresh(userId, connection.refreshToken);
  }

  private async refresh(userId: string, refreshToken: string): Promise<string> {
    this.logger.info('refreshing google access token', { userId });

    try {
      const refreshed = await this.oauth.refreshAccessToken(refreshToken);

      // Google rotates refresh tokens occasionally. Persisting the rotated one
      // is mandatory: keeping the old value means the next refresh fails with
      // invalid_grant and the student is told to reconnect for nothing.
      await this.connections.updateAccessToken(
        userId,
        refreshed.accessToken,
        refreshed.expiresAt,
        refreshed.refreshToken,
      );

      return refreshed.accessToken;
    } catch (caught) {
      if (caught instanceof AuthorizationExpiredError) {
        await this.connections.markStatus(userId, 'REVOKED', 'INVALID_GRANT');
        this.logger.warn('google authorization is no longer valid; reconnect required', {
          userId,
        });
        throw caught;
      }

      // Transient failures must not mark the connection broken -- doing so would
      // push a student through a consent flow because of a five-second outage.
      this.logger.error('google token refresh failed', {
        userId,
        errorCode: isAppError(caught) ? caught.code : 'UNKNOWN',
      });
      throw caught;
    }
  }

  private isUsable(token: string | null, expiresAt: Date | null): boolean {
    if (token === null || token === '') return false;
    if (expiresAt === null) return false;
    return expiresAt.getTime() - this.clock.now().getTime() > EXPIRY_SKEW_MS;
  }
}
