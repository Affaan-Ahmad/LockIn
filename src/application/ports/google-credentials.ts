/**
 * Google credential ports.
 *
 * Deliberately two interfaces rather than one. `GoogleCredentialProvider` is
 * what the sync pipeline is allowed to see: a single method that hands back a
 * usable access token and nothing else. It cannot read a refresh token, cannot
 * see expiry, and cannot persist anything -- so no amount of future code in the
 * sync path can leak or mishandle a long-lived credential.
 *
 * `GoogleConnectionRepository` is the storage side, used only by the token
 * service and the OAuth callback.
 */

export type GoogleConnectionStatus = 'ACTIVE' | 'NEEDS_RECONNECT' | 'REVOKED';

export interface GoogleCredentialProvider {
  /**
   * A valid access token for this user, refreshing transparently if needed.
   * Throws AuthorizationExpiredError when only a new consent flow can fix it.
   */
  getAccessToken(userId: string): Promise<string>;
}

/** Never leaves the server, and never carries plaintext outside the token service. */
export interface StoredGoogleConnection {
  readonly userId: string;
  readonly googleSub: string;
  /** Classroom's own user id, learned opportunistically. Null until observed. */
  readonly googleUserId: string | null;
  readonly grantedScopes: readonly string[];
  readonly accessToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshToken: string | null;
  readonly status: GoogleConnectionStatus;
  readonly connectedAt: Date;
  readonly lastRefreshedAt: Date | null;
  readonly lastErrorCode: string | null;
}

export interface GoogleConnectionSnapshot {
  readonly status: GoogleConnectionStatus;
  readonly grantedScopes: readonly string[];
  readonly connectedAt: Date;
  readonly accessTokenExpiresAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly googleUserId: string | null;
}

export interface UpsertConnectionInput {
  readonly userId: string;
  readonly googleSub: string;
  readonly grantedScopes: readonly string[];
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  /**
   * Google only returns a refresh token on the first consent (or with
   * prompt=consent). Null here means "keep whatever is already stored" -- it
   * must never be written as a null over a working token.
   */
  readonly refreshToken: string | null;
}

export interface GoogleConnectionRepository {
  findByUserId(userId: string): Promise<StoredGoogleConnection | null>;

  upsert(input: UpsertConnectionInput): Promise<void>;

  updateAccessToken(
    userId: string,
    accessToken: string,
    expiresAt: Date,
    rotatedRefreshToken: string | null,
    ): Promise<void>;

  markStatus(
    userId: string,
    status: GoogleConnectionStatus,
    errorCode: string | null,
    ): Promise<void>;

  /** Recorded once, when a Classroom response first reveals it. */
  setGoogleUserId(userId: string, googleUserId: string): Promise<void>;

  /** Status without credentials. This is the only shape an API route may return. */
  snapshot(userId: string): Promise<GoogleConnectionSnapshot | null>;
}

/** Exchanges refresh tokens. Isolated so the token service is unit-testable. */
export interface GoogleOAuthClient {
  refreshAccessToken(refreshToken: string): Promise<RefreshedCredentials>;
  revoke(token: string): Promise<void>;
}

export interface RefreshedCredentials {
  readonly accessToken: string;
  readonly expiresAt: Date;
  /** Google occasionally rotates the refresh token; persist it when present. */
  readonly refreshToken: string | null;
  readonly scopes: readonly string[] | null;
}
