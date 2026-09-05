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
  /**
   * True when a stored ciphertext was present but could not be decrypted --
   * almost always a GOOGLE_TOKEN_ENCRYPTION_KEY that differs from the one the
   * row was written with.
   *
   * It exists because `accessToken: null` and `refreshToken: null` cannot
   * otherwise be told apart from "the column was NULL", and the two demand
   * opposite responses: a genuinely absent refresh token means the student must
   * grant offline access again, while an unreadable one means the deployment is
   * misconfigured and no amount of reconnecting by the student is the fix.
   */
  readonly credentialsUnreadable: boolean;
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
  /** Exactly what Google reports, including scopes we never asked for. */
  readonly grantedScopes: readonly string[];
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  /**
   * Google only returns a refresh token on the first consent (or with
   * prompt=consent). Null here means "keep whatever is already stored" -- it
   * must never be written as a null over a working token.
   */
  readonly refreshToken: string | null;
  /**
   * The status the granted scopes imply, written in the same statement as the
   * scopes themselves.
   *
   * Not hardcoded to ACTIVE any more. A partial grant used to be stored ACTIVE
   * and corrected by a second call, which left a window -- however short -- in
   * which a connection missing half its permissions read as fully working, and
   * left it stuck that way if the second write failed. One row, one truth.
   */
  readonly status: GoogleConnectionStatus;
  readonly errorCode: string | null;
}

/**
 * Everything one refresh learned, written in a single statement.
 *
 * Separate arguments for the token, the expiry and the rotation were adequate
 * while success was the only outcome worth recording. They stopped being
 * adequate once Google could answer with a *narrower grant*: that outcome has
 * to persist the access token it just issued, any rotated refresh token, the
 * scopes Google actually reported and the status those scopes imply -- and
 * splitting that across two statements leaves a window in which the connection
 * is ACTIVE while holding permissions it no longer has, permanently so if the
 * second write is the one that fails.
 */
export interface RefreshedConnectionWrite {
  readonly userId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  /** Null means Google did not rotate it; keep whatever is already stored. */
  readonly rotatedRefreshToken: string | null;
  /**
   * Null means the refresh response said nothing about scopes, which is not
   * evidence of anything. The recorded grant is left exactly as it was.
   */
  readonly grantedScopes: readonly string[] | null;
  readonly status: GoogleConnectionStatus;
  readonly errorCode: string | null;
}

/**
 * The three things a stored refresh token can be, from outside the storage.
 *
 * Two of them produce no usable credential and demand opposite responses, which
 * is exactly why this is not a boolean:
 *
 *   ABSENT      nothing is stored. A consent problem, and the student fixes it
 *               by reconnecting with offline access.
 *   USABLE      stored, and this deployment's key opens it. The account can
 *               renew itself.
 *   UNREADABLE  stored, intact, and this key cannot open it -- almost always a
 *               GOOGLE_TOKEN_ENCRYPTION_KEY that differs from the one the row
 *               was written with. An operator fault. Reconnecting does not fix
 *               it, and nothing stored may be overwritten on the strength of
 *               it: the ciphertext is still good, and putting the right key
 *               back restores service with no user action at all.
 *
 * Collapsing UNREADABLE into ABSENT is how a key mismatch came to be reported
 * as a missing consent -- and then written over by the upsert that followed.
 */
export type RefreshTokenState = 'ABSENT' | 'USABLE' | 'UNREADABLE';

export interface GoogleConnectionRepository {
  findByUserId(userId: string): Promise<StoredGoogleConnection | null>;

  upsert(input: UpsertConnectionInput): Promise<void>;

  /**
   * Persists the result of a refresh -- credential, scopes and status together.
   *
   * Fenced on the connection still being ACTIVE, and reports whether it won.
   *
   * A refresh reads the row, spends a second or two at Google's token endpoint,
   * and only then writes. A student who disconnects inside that window has
   * their credentials nulled and the row marked REVOKED by `markStatus` -- and
   * an unfenced write would then put a live access token, a rotated refresh
   * token and an ACTIVE status straight back, silently undoing a disconnection
   * the student was told had happened.
   *
   * False means the row was no longer ACTIVE and *nothing at all was written*.
   * The caller must not treat the credential it is holding as usable, and must
   * not correct the status: whatever changed the row said something newer than
   * this refresh knows.
   */
  recordRefresh(input: RefreshedConnectionWrite): Promise<boolean>;

  /**
   * What the stored refresh token is, without ever being the stored refresh
   * token.
   *
   * A state, deliberately, and never the credential. The connection service has
   * to know whether a grant that carried no refresh token of its own will still
   * leave the account renewable after the upsert -- and answering that with the
   * credential itself would hand a long-lived secret to a layer that has no use
   * for one and no business holding it.
   */
  refreshTokenState(userId: string): Promise<RefreshTokenState>;

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

/**
 * Asks Google what an access token actually carries.
 *
 * Separate from `GoogleOAuthClient` rather than a fifth method on it, because
 * the two have different callers and different blast radii: the token service
 * refreshes and revokes, the connection service inspects. Nothing that can
 * inspect a token should be able to revoke one by accident.
 *
 * It exists at all because Supabase does not report the provider grant. Its
 * session carries `provider_token` and nothing about what that token may do, so
 * the only honest source for the granted scopes is Google itself.
 */
export interface GoogleTokenInspector {
  getTokenInfo(accessToken: string): Promise<GoogleTokenInfo>;
}

export interface GoogleTokenInfo {
  /**
   * Exactly the scopes Google says the token carries -- never the list we asked
   * for. A student can untick permissions on the consent screen, and the
   * request is the wrong place to learn what they decided.
   */
  readonly scopes: readonly string[];
  /** Google's own expiry, with refresh headroom already applied. */
  readonly expiresAt: Date;
}

export interface RefreshedCredentials {
  readonly accessToken: string;
  readonly expiresAt: Date;
  /** Google occasionally rotates the refresh token; persist it when present. */
  readonly refreshToken: string | null;
  readonly scopes: readonly string[] | null;
}
