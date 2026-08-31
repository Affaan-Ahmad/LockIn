import 'server-only';

import type {
  GoogleOAuthClient,
  RefreshedCredentials,
} from '@/application/ports/google-credentials';
import { AuthorizationExpiredError, GoogleApiError, RateLimitError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

import { googleTokenErrorSchema, googleTokenResponseSchema } from './classroom.schemas';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * The minimum read-only scopes this application needs.
 *
 * Least privilege is not just policy here -- Google's consent screen shows every
 * scope, and asking a student for roster or profile access to read their own
 * deadlines is both unnecessary and a reason not to grant consent at all. The
 * student's Classroom user id is instead learned from their own submissions.
 */
export const REQUIRED_CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
] as const;

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
export class GoogleOAuthHttpClient implements GoogleOAuthClient {
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

    const response = await this.post(TOKEN_ENDPOINT, body, 'google.oauth.refresh');
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
    const response = await this.post(REVOKE_ENDPOINT, body, 'google.oauth.revoke');
    if (!response.ok && response.status !== 400) {
      // 400 means the token was already invalid, which is the desired end state.
      this.logger.warn('token revocation returned an unexpected status', {
        status: response.status,
      });
    }
  }

  private async post(
    url: string,
    body: URLSearchParams,
    operation: string,
    ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      throw new GoogleApiError(`Network failure calling ${operation}`, {
        retryable: true,
        cause,
        context: { operation },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private translateTokenError(status: number, body: string): Error {
    const parsed = googleTokenErrorSchema.safeParse(safeJson(body));
    const code = parsed.success ? parsed.data.error : 'unknown_error';
    const description = parsed.success ? (parsed.data.error_description ?? '') : '';

    // invalid_grant is terminal. The user revoked access, changed their
    // password, the token expired from disuse, or the grant was deleted. Every
    // one of those requires a new consent flow, and retrying is pure noise
    // against a rate-limited endpoint.
    if (code === 'invalid_grant' || code === 'invalid_client') {
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
