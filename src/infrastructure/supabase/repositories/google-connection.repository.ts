import 'server-only';

import type {
  GoogleConnectionRepository,
  GoogleConnectionSnapshot,
  GoogleConnectionStatus,
  RefreshTokenState,
  RefreshedConnectionWrite,
  StoredGoogleConnection,
  UpsertConnectionInput,
} from '@/application/ports/google-credentials';
import { decodeKey, decryptSecret, encryptSecret } from '@/shared/crypto';
import { PersistenceError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

import type { AppSupabaseClient } from '../clients';
import { bufferToPgHex, pgHexToBuffer, translatePostgrestError } from './shared';

/**
 * The only code that reads or writes Google credentials.
 *
 * Requires a service-role client because `google_connections` has RLS enabled
 * with no policies -- no client role can reach it at all. That is intentional:
 * a refresh token grants read access to a student's coursework independently of
 * our session, so the blast radius of a leaked anon key must not include it.
 *
 * Every filter here is explicit about user_id even though the service role is
 * not subject to RLS. With RLS bypassed, a forgotten filter is a cross-account
 * data leak, so the filters are the only thing standing in the way.
 */
export class SupabaseGoogleConnectionRepository implements GoogleConnectionRepository {
  private readonly key: Buffer;

  constructor(
    private readonly db: AppSupabaseClient,
    encryptionKeyBase64: string,
    private readonly logger: Logger,
    ) {
    this.key = decodeKey(encryptionKeyBase64);
  }

  async findByUserId(userId: string): Promise<StoredGoogleConnection | null> {
    const { data, error } = await this.db
      .from('google_connections')
      .select(
        'user_id, google_sub, google_user_id, granted_scopes, access_token_ct, access_token_expires_at, refresh_token_ct, status, connected_at, last_refreshed_at, last_error_code',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.findByUserId');
    if (data === null) return null;

    const access = this.decryptOrNull(data.access_token_ct, userId, 'access');
    const refresh = this.decryptOrNull(data.refresh_token_ct, userId, 'refresh');

    return {
      userId: data.user_id,
      googleSub: data.google_sub,
      googleUserId: data.google_user_id,
      grantedScopes: data.granted_scopes,
      accessToken: access.value,
      accessTokenExpiresAt:
        data.access_token_expires_at === null ? null : new Date(data.access_token_expires_at),
      refreshToken: refresh.value,
      status: data.status,
      connectedAt: new Date(data.connected_at),
      lastRefreshedAt: data.last_refreshed_at === null ? null : new Date(data.last_refreshed_at),
      lastErrorCode: data.last_error_code,
      credentialsUnreadable: access.unreadable || refresh.unreadable,
    };
  }

  /**
   * Stores a freshly-granted credential.
   *
   * A null refreshToken means "Google did not send one this time", which
   * happens on every consent after the first unless prompt=consent was used. It
   * must leave the stored value untouched -- writing null would destroy the only
   * way to keep the connection alive and force the student to reconnect.
   *
   * The status arrives with the input rather than being assumed ACTIVE. Scopes
   * and the status they imply are written in one statement, so there is no
   * moment at which a partial grant is stored as a working connection.
   */
  async upsert(input: UpsertConnectionInput): Promise<void> {
    const base = {
      user_id: input.userId,
      google_sub: input.googleSub,
      granted_scopes: [...input.grantedScopes],
      access_token_ct: bufferToPgHex(this.encrypt(input.accessToken, input.userId)),
      access_token_expires_at: input.accessTokenExpiresAt.toISOString(),
      status: input.status,
      last_error_code: input.errorCode,
      revoked_at: null,
    };

    const payload =
      input.refreshToken === null
        ? base
        : {
            ...base,
            refresh_token_ct: bufferToPgHex(this.encrypt(input.refreshToken, input.userId)),
          };

    const { error } = await this.db
      .from('google_connections')
      .upsert(payload, { onConflict: 'user_id' });

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.upsert');
  }

  /**
   * Records the outcome of a refresh: credential, scopes and status at once.
   *
   * One statement, because a refresh that comes back with a narrower grant has
   * to store a live access token *and* a non-ACTIVE status. Written separately,
   * the moment between them is a connection that reads as working while holding
   * permissions it does not have -- and a failure of the second write makes that
   * moment permanent.
   *
   * Two fields are omitted rather than nulled when absent. A null rotated token
   * means Google did not rotate, and writing that null would destroy the only
   * credential that can renew the connection; a null scope list means the
   * response said nothing about scopes, which is not evidence that the grant
   * shrank.
   *
   * The `status` predicate is a fence, not a filter. A refresh reads the row,
   * spends a round trip at Google's token endpoint, and writes afterwards; a
   * student who disconnects during that window has the row set REVOKED and its
   * ciphertexts nulled, and this write would otherwise restore a live access
   * token, a rotated refresh token and an ACTIVE status over the top of it --
   * reconnecting an account the student was told was disconnected, with no
   * error anywhere to notice.
   *
   * One statement does both. Reading the status first and then updating would
   * be the same race one step smaller, so the check is the UPDATE's own WHERE
   * clause and the answer is how many rows it touched. `select()` makes that an
   * `UPDATE ... RETURNING`, so the count comes from the statement itself rather
   * than from a second query that could see a different row. Only `user_id` is
   * returned: this method has no reason to read a credential back out.
   *
   * Returns false when the fence lost, in which case nothing was written.
   */
  async recordRefresh(input: RefreshedConnectionWrite): Promise<boolean> {
    const payload = {
      access_token_ct: bufferToPgHex(this.encrypt(input.accessToken, input.userId)),
      access_token_expires_at: input.accessTokenExpiresAt.toISOString(),
      last_refreshed_at: new Date().toISOString(),
      status: input.status,
      last_error_code: input.errorCode,
      ...(input.rotatedRefreshToken === null
        ? {}
        : {
            refresh_token_ct: bufferToPgHex(
              this.encrypt(input.rotatedRefreshToken, input.userId),
            ),
          }),
      ...(input.grantedScopes === null ? {} : { granted_scopes: [...input.grantedScopes] }),
    };

    const { data, error } = await this.db
      .from('google_connections')
      .update(payload)
      .eq('user_id', input.userId)
      // The fence. Anything that is not ACTIVE has been decided by something
      // newer than this refresh -- a disconnection, or a grant already found
      // insufficient -- and this write must lose to it.
      .eq('status', 'ACTIVE')
      .select('user_id');

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.recordRefresh');

    return (data ?? []).length > 0;
  }

  /**
   * What this account's stored refresh token is: absent, usable, or unreadable.
   *
   * Returns a state and nothing else. The caller needs to decide whether a
   * connection is durable, not to hold the credential that makes it so, and
   * neither the plaintext nor the ciphertext leaves this method.
   *
   * Three states rather than a boolean because the two failing ones are not the
   * same incident. A ciphertext written with a different
   * GOOGLE_TOKEN_ENCRYPTION_KEY cannot be exchanged with Google -- so it is not
   * USABLE -- but it is emphatically not ABSENT either: the credential is still
   * there, still good, and reporting it as missing invites the caller to write
   * over it while repairing a fault that was never the student's.
   */
  async refreshTokenState(userId: string): Promise<RefreshTokenState> {
    const { data, error } = await this.db
      .from('google_connections')
      .select('refresh_token_ct')
      .eq('user_id', userId)
      .maybeSingle();

    if (error !== null) {
      throw translatePostgrestError(error, 'googleConnections.refreshTokenState');
    }
    // No row at all: this account has never connected. Absent, not unreadable.
    if (data === null) return 'ABSENT';

    const refresh = this.decryptOrNull(data.refresh_token_ct, userId, 'refresh');
    if (refresh.unreadable) return 'UNREADABLE';
    return refresh.value === null ? 'ABSENT' : 'USABLE';
  }

  async markStatus(
    userId: string,
    status: GoogleConnectionStatus,
    errorCode: string | null,
    ): Promise<void> {
    const { error } = await this.db
      .from('google_connections')
      .update({
        status,
        last_error_code: errorCode,
        revoked_at: status === 'REVOKED' ? new Date().toISOString() : null,
        // A revoked grant's stored tokens are dead weight and a liability.
        ...(status === 'REVOKED' ? { access_token_ct: null, refresh_token_ct: null } : {}),
      })
      .eq('user_id', userId);

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.markStatus');
  }

  async setGoogleUserId(userId: string, googleUserId: string): Promise<void> {
    const { error } = await this.db
      .from('google_connections')
      .update({ google_user_id: googleUserId })
      .eq('user_id', userId)
      // Written once. Overwriting would mean the account behind the connection
      // changed, which should be a reconnect, not a silent update.
      .is('google_user_id', null);

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.setGoogleUserId');
  }

  /**
   * Status without credentials.
   *
   * This is the only shape any API route may return. The full connection object
   * carries decrypted tokens and must never leave the server.
   */
  async snapshot(userId: string): Promise<GoogleConnectionSnapshot | null> {
    const { data, error } = await this.db
      .from('google_connections')
      .select(
        'status, granted_scopes, connected_at, access_token_expires_at, last_error_code, google_user_id',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.snapshot');
    if (data === null) return null;

    return {
      status: data.status,
      grantedScopes: data.granted_scopes,
      connectedAt: new Date(data.connected_at),
      accessTokenExpiresAt:
        data.access_token_expires_at === null ? null : new Date(data.access_token_expires_at),
      lastErrorCode: data.last_error_code,
      googleUserId: data.google_user_id,
    };
  }

  /**
   * The user id is used as additional authenticated data, so a ciphertext moved
   * between rows fails authentication instead of decrypting into a token that
   * belongs to somebody else.
   */
  private encrypt(plaintext: string, userId: string): Buffer {
    return encryptSecret(plaintext, this.key, userId);
  }

  /**
   * Decrypts one stored ciphertext, reporting *why* it produced nothing.
   *
   * `unreadable` is the whole point. A NULL column and a ciphertext that fails
   * AES-GCM authentication both yield no usable token, but they are different
   * incidents: the first is a consent problem the student can fix by
   * reconnecting, the second is a key problem only the operator can fix. The
   * caller must be able to tell them apart, so this returns both facts rather
   * than flattening them into `null`.
   *
   * Nothing derived from the ciphertext is logged -- not the bytes, not their
   * length, which would leak the size of the plaintext token.
   */
  private decryptOrNull(
    hex: string | null,
    userId: string,
    label: 'access' | 'refresh',
    ): { value: string | null; unreadable: boolean } {
    const buffer = pgHexToBuffer(hex);
    if (buffer === null) return { value: null, unreadable: false };

    try {
      return { value: decryptSecret(buffer, this.key, userId), unreadable: false };
    } catch (cause) {
      if (cause instanceof PersistenceError) {
        const reason = cause.context['reason'];
        this.logger.error('stored google credential could not be decrypted', {
          errorCode: 'CREDENTIAL_DECRYPTION_FAILED',
          userId,
          materialKind: label,
          // AUTH_FAILED here means the envelope is intact but this key did not
          // produce it: check GOOGLE_TOKEN_ENCRYPTION_KEY for this deployment
          // before concluding anything about the student's Google grant.
          reason: typeof reason === 'string' ? reason : 'UNKNOWN',
        });
        return { value: null, unreadable: true };
      }
      throw cause;
    }
  }
}
