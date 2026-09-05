import type {
  GoogleConnectionRepository,
  GoogleTokenInfo,
  GoogleTokenInspector,
  RefreshTokenState,
} from '@/application/ports/google-credentials';
import {
  INSUFFICIENT_SCOPES,
  NO_REFRESH_TOKEN,
  missingClassroomScopes,
} from '@/domain/google/scopes';
import { AuthorizationExpiredError, ConfigError, isAppError, isRetryable } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

/**
 * Turns a provider grant into a stored connection, or refuses to.
 *
 * The OAuth callback used to do this itself, and it did it by asserting: it
 * wrote `REQUIRED_CLASSROOM_SCOPES` into `granted_scopes` because that is what
 * the consent URL asked for. Google's consent screen lets a student untick
 * individual permissions, so the row recorded a grant that may never have been
 * given -- and every screen that reads it, including the one that decides
 * whether the account is connected at all, believed it.
 *
 * Supabase cannot help here. Its session carries `provider_token` and nothing
 * about what that token may do, so the scopes have to be read from Google.
 *
 * Four outcomes, deliberately distinct:
 *
 *   CONNECTED           every required scope present, and something can renew
 *                       the credential; the row is ACTIVE.
 *   INCOMPLETE_SCOPES   a real, partial grant; stored truthfully and marked
 *                       NEEDS_RECONNECT so nothing tries to sync with it.
 *   NO_REFRESH_TOKEN    the scopes are fine but nothing can renew the access
 *                       token, so the connection would expire in about an hour
 *                       with no event to explain it. Also NEEDS_RECONNECT.
 *   UNVERIFIED          we could not ask Google. Nothing is written at all.
 *
 * The last is the one worth being careful about. An outage, a timeout, an error
 * status or a response we cannot parse says nothing about the student's
 * consent, so it must not invent a full grant, must not overwrite the working
 * connection that may already be stored, and must not be reported as a
 * revocation.
 *
 * A fifth case is not an outcome at all but a thrown ConfigError: a refresh
 * token that is stored, intact, and undecryptable with this deployment's key.
 * That is our misconfiguration rather than anything about the grant, it is not
 * a state the student can be asked to repair, and -- like UNVERIFIED -- nothing
 * is written.
 */

export type ConnectionResult =
  | { readonly kind: 'CONNECTED'; readonly grantedScopes: readonly string[] }
  | {
      readonly kind: 'INCOMPLETE_SCOPES';
      readonly grantedScopes: readonly string[];
      readonly missingScopes: readonly string[];
    }
  | { readonly kind: 'NO_REFRESH_TOKEN'; readonly grantedScopes: readonly string[] }
  | { readonly kind: 'UNVERIFIED' };

export interface ProviderGrant {
  readonly userId: string;
  readonly googleSub: string;
  readonly accessToken: string;
  /**
   * Null on every consent after the first unless prompt=consent was used.
   * Passed through as null so the repository keeps whatever is already stored;
   * writing null over a working refresh token is how a reconnect breaks a
   * connection that was fine.
   */
  readonly refreshToken: string | null;
}

/**
 * Refuses work that the stored grant cannot possibly do.
 *
 * The token service applies the same rule, and would stop the sync anyway --
 * but only after a run has been claimed, a lease taken and a failure recorded,
 * which presents a permissions problem to the student as a broken sync. This
 * turns it into the message that names the fix.
 *
 * A missing connection is deliberately not this function's business. "Never
 * connected" is a different fault with a different screen, and it is already
 * reported by the layer that reads the credential.
 */
export function assertClassroomScopesGranted(
  connection: { readonly grantedScopes: readonly string[] } | null,
): void {
  if (connection === null) return;

  const missing = missingClassroomScopes(connection.grantedScopes);
  if (missing.length === 0) return;

  throw new AuthorizationExpiredError(
    'Google Classroom is connected without all the permissions LockIn needs. Reconnect it and accept every permission on the Google screen.',
    { context: { missingScopeCount: missing.length } },
  );
}

export interface GoogleConnectionServiceOptions {
  readonly connections: GoogleConnectionRepository;
  readonly inspector: GoogleTokenInspector;
  readonly logger: Logger;
}

export class GoogleConnectionService {
  private readonly connections: GoogleConnectionRepository;
  private readonly inspector: GoogleTokenInspector;
  private readonly logger: Logger;

  constructor(options: GoogleConnectionServiceOptions) {
    this.connections = options.connections;
    this.inspector = options.inspector;
    this.logger = options.logger;
  }

  async storeProviderGrant(grant: ProviderGrant): Promise<ConnectionResult> {
    const verified = await this.inspect(grant);
    if (!verified.ok) return { kind: 'UNVERIFIED' };

    const info = verified.info;
    const missing = missingClassroomScopes(info.scopes);
    const complete = missing.length === 0;

    // An ACTIVE connection has to be one that survives the hour.
    //
    // Google issues a refresh token on the first consent and, with
    // prompt=consent, normally on later ones -- but "normally" is not "always",
    // and a grant that arrives without one is usable only until its access
    // token expires. Storing that as ACTIVE produces the worst kind of failure:
    // an account that reads as connected on every screen and stops working by
    // itself, roughly an hour later, with no event anyone can point at.
    //
    // A null refresh token still means "keep what is stored", so the question
    // is not whether *this* grant carried one but whether one will be there
    // after the write. The repository answers with a state; the credential
    // itself has no business in this layer.
    //
    // A grant that brought its own refresh token settles the question by
    // itself: the write stores that token, so the account is renewable however
    // the previous one reads. Nothing to look up, and no reason to.
    const stored: RefreshTokenState =
      grant.refreshToken !== null
        ? 'USABLE'
        : await this.connections.refreshTokenState(grant.userId);

    // The one state that must not reach the write.
    //
    // An unreadable ciphertext is a stored refresh token this deployment's key
    // cannot open -- an operator fault, and the credential itself is intact.
    // Treated as absent it would be indistinguishable from a student who never
    // granted offline access, and the upsert below would then overwrite the
    // access token, the scopes and the status of a connection that was fine,
    // recording NEEDS_RECONNECT against a fault no reconnection can fix. Worse,
    // it destroys the evidence: after the write, the row looks like an ordinary
    // failed consent.
    //
    // So nothing is written at all. Putting the correct
    // GOOGLE_TOKEN_ENCRYPTION_KEY back restores the account with no user action.
    if (stored === 'UNREADABLE') {
      // No credential, no ciphertext, not even a length -- only the code that
      // names the environment variable to check.
      this.logger.error('stored google refresh token could not be decrypted; nothing written', {
        errorCode: 'CREDENTIAL_DECRYPTION_FAILED',
        userId: grant.userId,
      });
      throw new ConfigError(
        'A stored Google refresh token could not be decrypted. GOOGLE_TOKEN_ENCRYPTION_KEY does not match the key this row was written with; the connection was left untouched.',
        { context: { userId: grant.userId } },
      );
    }

    const durable = stored === 'USABLE';
    const usable = complete && durable;

    // One write. The scopes, the renewability and the status they jointly imply
    // are the same fact, and storing ACTIVE first and correcting it afterwards
    // leaves a window in which a connection that cannot work reads as a working
    // one -- permanently, if the second write is the one that fails.
    await this.connections.upsert({
      userId: grant.userId,
      googleSub: grant.googleSub,
      // Exactly what Google reports, extra scopes and all. Storing the list we
      // asked for is the bug this whole path exists to fix.
      grantedScopes: info.scopes,
      accessToken: grant.accessToken,
      accessTokenExpiresAt: info.expiresAt,
      refreshToken: grant.refreshToken,
      status: usable ? 'ACTIVE' : 'NEEDS_RECONNECT',
      // Missing permissions win the label when both are wrong: the student has
      // to redo consent either way, and only that message names a box to tick.
      errorCode: complete ? (durable ? null : NO_REFRESH_TOKEN) : INSUFFICIENT_SCOPES,
    });

    // Counts and scope names only -- never the token, and never the payload it
    // arrived in.
    //
    // `grantCarriedRenewal` says whether this consent brought its own means of
    // renewal, which `durable` alone cannot: durable is true both for a fresh
    // refresh token and for one that was already stored, and only the first
    // explains why no lookup happened. It is named around the grant rather than
    // the credential because the redactor matches key substrings -- `token`,
    // `secret`, `credential` -- and a boolean called `hasRefreshToken` is
    // written out as [REDACTED], which is a log line that says nothing.
    this.logger.info('google classroom connection stored', {
      userId: grant.userId,
      grantCarriedRenewal: grant.refreshToken !== null,
      durable,
      grantedScopeCount: info.scopes.length,
      missingScopes: missing,
    });

    if (!complete) {
      return { kind: 'INCOMPLETE_SCOPES', grantedScopes: info.scopes, missingScopes: missing };
    }
    if (!durable) return { kind: 'NO_REFRESH_TOKEN', grantedScopes: info.scopes };
    return { kind: 'CONNECTED', grantedScopes: info.scopes };
  }

  private async inspect(
    grant: ProviderGrant,
    ): Promise<{ readonly ok: true; readonly info: GoogleTokenInfo } | { readonly ok: false }> {
    try {
      return { ok: true, info: await this.inspector.getTokenInfo(grant.accessToken) };
    } catch (caught) {
      // Deliberately not an error-level log and deliberately not a status
      // change: we do not know anything about the student's grant, so the
      // stored row -- which may be a perfectly good existing connection -- is
      // left exactly as it was.
      //
      // Whether the failure was transient is worth recording for whoever reads
      // these lines, and is deliberately not carried back to the caller: every
      // way of failing to ask Google produces the same outcome for the student
      // -- nothing written, and one message telling them to try again -- so a
      // flag that reached the screen without changing anything on it would only
      // be a claim nobody checks.
      this.logger.warn('could not verify the google grant; connection not written', {
        userId: grant.userId,
        errorCode: isAppError(caught) ? caught.code : 'UNKNOWN',
        retryable: isRetryable(caught),
      });
      return { ok: false };
    }
  }
}
