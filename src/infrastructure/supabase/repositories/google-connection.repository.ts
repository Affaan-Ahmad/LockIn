import 'server-only';

import type {
  GoogleConnectionRepository,
  GoogleConnectionSnapshot,
  GoogleConnectionStatus,
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
   */
  async upsert(input: UpsertConnectionInput): Promise<void> {
    const base = {
      user_id: input.userId,
      google_sub: input.googleSub,
      granted_scopes: [...input.grantedScopes],
      access_token_ct: bufferToPgHex(this.encrypt(input.accessToken, input.userId)),
      access_token_expires_at: input.accessTokenExpiresAt.toISOString(),
      status: 'ACTIVE' as const,
      last_error_code: null,
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

  async updateAccessToken(
    userId: string,
    accessToken: string,
    expiresAt: Date,
    rotatedRefreshToken: string | null,
    ): Promise<void> {
    const base = {
      access_token_ct: bufferToPgHex(this.encrypt(accessToken, userId)),
      access_token_expires_at: expiresAt.toISOString(),
      last_refreshed_at: new Date().toISOString(),
      status: 'ACTIVE' as const,
      last_error_code: null,
    };

    const payload =
      rotatedRefreshToken === null
        ? base
        : {
            ...base,
            refresh_token_ct: bufferToPgHex(this.encrypt(rotatedRefreshToken, userId)),
          };

    const { error } = await this.db
      .from('google_connections')
      .update(payload)
      .eq('user_id', userId);

    if (error !== null) throw translatePostgrestError(error, 'googleConnections.updateAccessToken');
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
          credential: label,
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
