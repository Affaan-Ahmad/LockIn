import type {
  GoogleConnectionRepository,
  GoogleCredentialProvider,
  GoogleOAuthClient,
  RefreshedCredentials,
} from '@/application/ports/google-credentials';
import {
  INSUFFICIENT_SCOPES,
  NO_REFRESH_TOKEN,
  missingClassroomScopes,
} from '@/domain/google/scopes';
import type { Clock } from '@/shared/clock';
import {
  AuthorizationExpiredError,
  AuthenticationError,
  ConfigError,
  isAppError,
} from '@/shared/errors';
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
    //
    // And nothing puts them back. A refresh already in flight writes through a
    // statement fenced on the row still being ACTIVE, so this is the last word
    // on the connection even when it lands mid-sync.
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

    // Already known to need a new consent. Re-deciding that on every call would
    // let a stale-but-unexpired access token slip a request past a connection we
    // have already declared unusable, and would rewrite the status -- and its
    // error code -- on every attempt.
    if (connection.status === 'NEEDS_RECONNECT') {
      throw new AuthorizationExpiredError(
        'Google Classroom access needs to be reconnected',
        { context: { userId, lastErrorCode: connection.lastErrorCode } },
      );
    }

    // Checked before anything is judged missing. A ciphertext we cannot decrypt
    // is a deployment fault, not a revoked grant, and the two must not converge
    // on the same remedy: marking the connection NEEDS_RECONNECT here would push
    // every student through a consent flow to repair an environment variable --
    // and would keep doing so after the key was put back, because the stored
    // ciphertext is still perfectly good.
    //
    // So: fail loudly, change nothing. Restoring the correct
    // GOOGLE_TOKEN_ENCRYPTION_KEY restores service with no user action at all.
    if (connection.credentialsUnreadable) {
      this.logger.error('stored google credentials could not be decrypted', {
        errorCode: 'CREDENTIAL_DECRYPTION_FAILED',
        userId,
      });
      throw new ConfigError(
        'Stored Google credentials could not be decrypted. GOOGLE_TOKEN_ENCRYPTION_KEY does not match the key these rows were written with.',
        { context: { userId } },
      );
    }

    // A credential can be perfectly valid and still not permit the work.
    //
    // Google's consent screen lets a student untick individual permissions, so
    // a token that cannot list courses is a normal outcome of a normal consent
    // flow. Handing it out anyway turns a missing permission into a 403 in the
    // middle of a sync -- which the sync then reports as a Google failure, and
    // which no amount of retrying fixes because the student was never asked
    // again. This is the gate: incomplete grants do not reach Google at all.
    const missing = missingClassroomScopes(connection.grantedScopes);
    if (missing.length > 0) {
      // NEEDS_RECONNECT, never REVOKED: the stored credentials are real and
      // must survive, because reconnecting reuses the same row and a repeat
      // consent often carries no new refresh token.
      await this.connections.markStatus(userId, 'NEEDS_RECONNECT', INSUFFICIENT_SCOPES);
      throw new AuthorizationExpiredError(
        'The Google connection is missing Classroom permissions it needs; reconnect and accept all of them',
        { context: { userId, missingScopeCount: missing.length } },
      );
    }

    if (this.isUsable(connection.accessToken, connection.accessTokenExpiresAt)) {
      return connection.accessToken as string;
    }

    if (connection.refreshToken === null) {
      // Without a refresh token there is no path back to a working credential.
      // This happens when Google was not asked for offline access, or when a
      // prior consent was reused without prompt=consent.
      await this.connections.markStatus(userId, 'NEEDS_RECONNECT', NO_REFRESH_TOKEN);
      throw new AuthorizationExpiredError(
        'No Google refresh token is stored; the student must reconnect with offline access',
        { context: { userId } },
      );
    }

    return this.refresh(userId, connection.refreshToken);
  }

  private async refresh(userId: string, refreshToken: string): Promise<string> {
    this.logger.info('refreshing google access token', { userId });

    let refreshed: RefreshedCredentials;

    // Only the exchange itself is guarded. What follows must not be, because
    // this handler reads AuthorizationExpiredError as "the grant is gone" and
    // marks the connection REVOKED -- which nulls the stored ciphertexts. A
    // scope problem raised below is a different fault with a different remedy,
    // and letting it fall in here would destroy a credential that still works.
    try {
      refreshed = await this.oauth.refreshAccessToken(refreshToken);
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

    // Google reports the scopes attached to the token it just issued. When it
    // says the grant has shrunk, that is newer information than the stored row,
    // and continuing would mean syncing against permissions we no longer hold.
    // Acted on only when Google actually said something: a refresh response
    // without a scope field is not evidence of anything.
    const narrowed =
      refreshed.scopes !== null && missingClassroomScopes(refreshed.scopes).length > 0;

    // One write, and it happens on both paths -- including the one that is about
    // to throw.
    //
    // What Google just returned is real regardless of what it permits. The
    // access token is the newest we will ever hold for this user, and a rotated
    // refresh token is the *only* one that still works: dropping it because the
    // scopes came back short would guarantee invalid_grant on the next attempt
    // and turn a fixable permissions problem into a dead connection that no
    // reconnect can repair without a fresh consent. The scopes are stored as
    // reported so the connect screen names what is actually missing instead of
    // repeating a stale list.
    //
    // NEEDS_RECONNECT, never REVOKED: the credential is alive and the
    // permissions are not sufficient, and only the second of those justifies
    // throwing stored tokens away. This sits outside the invalid_grant handler
    // above for exactly that reason.
    //
    // The write is fenced on the row still being ACTIVE and says whether it
    // won, because the row this decision was made from was read before the
    // round trip to Google and may have been disconnected since.
    const stored = await this.connections.recordRefresh({
      userId,
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: refreshed.expiresAt,
      // Null means Google did not rotate it; the stored value must survive.
      rotatedRefreshToken: refreshed.refreshToken,
      grantedScopes: refreshed.scopes,
      status: narrowed ? 'NEEDS_RECONNECT' : 'ACTIVE',
      errorCode: narrowed ? INSUFFICIENT_SCOPES : null,
    });

    // The write lost its fence: the connection stopped being ACTIVE while this
    // refresh was at Google's token endpoint. In practice that is a student
    // disconnecting mid-sync, which nulls the stored ciphertexts and marks the
    // row REVOKED.
    //
    // Nothing was written, and nothing may be written now. Returning the access
    // token would hand out a credential for an account that has just been
    // disconnected; marking any status would overwrite the disconnection's own
    // result with a conclusion drawn from a row that no longer exists as read.
    // The one honest response is to fail the way every other lost-authorization
    // path fails, and to leave the newer decision standing.
    //
    // Checked before the narrowed-grant branch below, because that branch
    // reports a write that did not happen.
    if (!stored) {
      this.logger.warn('google connection changed during refresh; refreshed credential discarded', {
        userId,
      });
      throw new AuthorizationExpiredError(
        'The Google connection changed while its access token was being refreshed; reconnect to continue',
        { context: { userId } },
      );
    }

    if (narrowed) {
      this.logger.warn('google reports a narrower grant than the connection recorded', {
        userId,
        grantedScopeCount: refreshed.scopes?.length ?? 0,
      });
      throw new AuthorizationExpiredError(
        'Google no longer grants all the Classroom permissions this connection needs',
        { context: { userId } },
      );
    }

    return refreshed.accessToken;
  }

  private isUsable(token: string | null, expiresAt: Date | null): boolean {
    if (token === null || token === '') return false;
    if (expiresAt === null) return false;
    return expiresAt.getTime() - this.clock.now().getTime() > EXPIRY_SKEW_MS;
  }
}
