import 'server-only';

import type {
  GoogleOAuthClient,
  GoogleTokenInfo,
  GoogleTokenInspector,
  RefreshedCredentials,
} from '@/application/ports/google-credentials';
import {
  AuthorizationExpiredError,
  ConfigError,
  GoogleApiError,
  RateLimitError,
} from '@/shared/errors';
import type { Logger } from '@/shared/logger';

import {
  googleTokenErrorSchema,
  googleTokenInfoSchema,
  googleTokenResponseSchema,
} from './classroom.schemas';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
/**
 * Google's own client library posts here with the token in an Authorization
 * header and nothing in the URL. That detail is not cosmetic: the older
 * `?access_token=` form puts a live credential into every proxy log, browser
 * history and error report along the way.
 */
const TOKEN_INFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

export interface GoogleOAuthClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Talks to Google's token endpoint. Nothing else in the codebase does.
 *
 * Isolated behind the GoogleOAuthClient port so the token service can be unit
 * tested against a fake, and so there is exactly one place that handles the
 * `invalid_grant` response -- the signal that consent is gone and no retry will
 * ever help.
 */
export class GoogleOAuthHttpClient implements GoogleOAuthClient, GoogleTokenInspector {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GoogleOAuthClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedCredentials> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await this.post(TOKEN_ENDPOINT, 'google.oauth.refresh', { body });
    const text = await response.text();

    if (!response.ok) {
      throw this.translateTokenError(response.status, text);
    }

    const parsed = googleTokenResponseSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new GoogleApiError('Google token endpoint returned an unexpected payload', {
        status: response.status,
        retryable: false,
        cause: parsed.error,
      });
    }

    const data = parsed.data;
    return {
      accessToken: data.access_token,
      // A minute of headroom: a token that expires while a request is in flight
      // produces a spurious 401 that looks like revoked consent.
      expiresAt: new Date(Date.now() + Math.max(0, data.expires_in - 60) * 1000),
      refreshToken: data.refresh_token ?? null,
      scopes: data.scope === undefined ? null : data.scope.split(' ').filter((s) => s !== ''),
    };
  }

  async revoke(token: string): Promise<void> {
    const body = new URLSearchParams({ token });
    const response = await this.post(REVOKE_ENDPOINT, 'google.oauth.revoke', { body });
    if (!response.ok && response.status !== 400) {
      // 400 means the token was already invalid, which is the desired end state.
      this.logger.warn('token revocation returned an unexpected status', {
        status: response.status,
      });
    }
  }

  /**
   * What Google says this access token actually carries.
   *
   * The shape of the request follows Google's own auth library: POST, the token
   * in an Authorization header, a form content type, and nothing in the URL or
   * the body. The alternative -- `GET /tokeninfo?access_token=...` -- is still
   * accepted by Google and still a mistake, because a URL is the one part of a
   * request that gets written down everywhere.
   *
   * Nothing here logs the token, the headers, or the raw response. The scopes
   * are the answer; the payload they arrived in is a credential envelope.
   */
  async getTokenInfo(accessToken: string): Promise<GoogleTokenInfo> {
    const response = await this.post(TOKEN_INFO_ENDPOINT, 'google.oauth.tokeninfo', {
      bearerToken: accessToken,
    });
    const text = await response.text();

    if (!response.ok) {
      throw this.translateTokenInfoError(response.status, text);
    }

    const parsed = googleTokenInfoSchema.safeParse(safeJson(text));
    if (!parsed.success) {
      throw new GoogleApiError('Google tokeninfo returned an unexpected payload', {
        status: response.status,
        retryable: false,
        cause: parsed.error,
      });
    }

    const scopes = parsed.data.scope.split(' ').filter((scope) => scope !== '');
    if (scopes.length === 0) {
      // A 200 with an empty scope string is not "the student granted nothing" --
      // a token with no scopes could not have been issued. It is a response we
      // do not understand, and the caller must treat it as unverified rather
      // than as a grant of nothing.
      throw new GoogleApiError('Google tokeninfo reported no scopes for a live token', {
        status: response.status,
        retryable: false,
      });
    }

    if (parsed.data.expires_in <= 0) {
      throw new GoogleApiError('Google tokeninfo reported an already-expired token', {
        status: response.status,
        retryable: false,
      });
    }

    return {
      scopes,
      // The same minute of headroom the refresh path applies: a token that
      // expires while a request is in flight produces a spurious 401 that looks
      // exactly like revoked consent.
      expiresAt: new Date(Date.now() + Math.max(0, parsed.data.expires_in - 60) * 1000),
    };
  }

  private async post(
    url: string,
    operation: string,
    init: { body?: URLSearchParams; bearerToken?: string },
    ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      // Charset spelled out because Google's own client sends it that way, and
      // this endpoint is old enough that matching it exactly costs nothing.
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    };
    if (init.bearerToken !== undefined) {
      headers['Authorization'] = `Bearer ${init.bearerToken}`;
    }

    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
      });
    } catch (cause) {
      // The operation label only. Never the headers, which carry the credential.
      throw new GoogleApiError(`Network failure calling ${operation}`, {
        retryable: true,
        cause,
        context: { operation },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Errors from tokeninfo, kept away from the refresh error taxonomy.
   *
   * Deliberately never AuthorizationExpiredError. That is the code the token
   * service reads as "the grant is gone", and its response is to mark the
   * connection REVOKED -- which nulls the stored ciphertexts. A tokeninfo call
   * that fails means we could not verify the grant, which is a different and far
   * weaker claim than knowing it was withdrawn, and acting on the stronger one
   * would destroy a working credential over a bad minute at Google.
   */
  private translateTokenInfoError(status: number, body: string): Error {
    const parsed = googleTokenErrorSchema.safeParse(safeJson(body));
    const code = parsed.success ? parsed.data.error : 'unknown_error';

    if (status === 429) {
      return new RateLimitError('Google rate limited the tokeninfo endpoint', {
        context: { status, code },
      });
    }

    if (status >= 500) {
      return new GoogleApiError(`Google tokeninfo server error (${code})`, {
        status,
        retryable: true,
        context: { code },
      });
    }

    return new GoogleApiError(`Google would not describe this access token (${code})`, {
      status,
      retryable: false,
      context: { code },
    });
  }

  private translateTokenError(status: number, body: string): Error {
    const parsed = googleTokenErrorSchema.safeParse(safeJson(body));
    const code = parsed.success ? parsed.data.error : 'unknown_error';
    const description = parsed.success ? (parsed.data.error_description ?? '') : '';

    // invalid_client says *our* OAuth client is wrong -- a bad client id or
    // secret, or a deleted client. It says nothing about the student's consent.
    //
    // It used to be folded in with invalid_grant below, which made a mistyped
    // GOOGLE_OAUTH_CLIENT_SECRET catastrophic: the token service marks an
    // AuthorizationExpiredError as REVOKED, and marking REVOKED nulls the
    // stored ciphertexts. One wrong environment variable would therefore have
    // destroyed every user's refresh token, irreversibly, and required all of
    // them to grant consent again to repair a deployment mistake.
    if (code === 'invalid_client') {
      return new ConfigError(
        `Google rejected this OAuth client (${code}): ${description}. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET for this deployment.`,
        { context: { status, code } },
      );
    }

    // invalid_grant is terminal. The user revoked access, changed their
    // password, the token expired from disuse, or the grant was deleted. Every
    // one of those requires a new consent flow, and retrying is pure noise
    // against a rate-limited endpoint.
    if (code === 'invalid_grant') {
      return new AuthorizationExpiredError(
        `Google refused to refresh the credential (${code}): ${description}`,
        { context: { status, code } },
      );
    }

    if (status === 429) {
      return new RateLimitError('Google rate limited the token endpoint', {
        context: { status, code },
      });
    }

    if (status >= 500) {
      return new GoogleApiError(`Google token endpoint server error (${code})`, {
        status,
        retryable: true,
        context: { code },
      });
    }

    return new GoogleApiError(`Google token refresh failed (${code}): ${description}`, {
      status,
      retryable: false,
      context: { code },
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
