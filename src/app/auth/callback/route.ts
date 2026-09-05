import { NextResponse } from 'next/server';

import type { ConnectionResult } from '@/application/services/google-connection.service';
import { getServerEnv } from '@/config/env';
import {
  CONNECTION_FEEDBACK,
  connectionFeedbackPath,
  connectionRedirectPath,
  type ConnectionFeedbackCode,
} from '@/features/connection/connection-feedback';
import { createGoogleConnectionService, createRootLogger } from '@/infrastructure/composition';
import { createUserScopedClient } from '@/infrastructure/supabase/clients';
import { isAppError } from '@/shared/errors';

/**
 * OAuth callback.
 *
 * This route exists because of one fact about Supabase Auth: it surfaces
 * `provider_token` and `provider_refresh_token` exactly once, in the session
 * produced by the code exchange, and never refreshes them. If they are not
 * captured here, Classroom access stops working as soon as the first access
 * token expires -- roughly an hour later, long after the developer has moved on.
 *
 * The capture happens server-side and the tokens go straight into an encrypted
 * column. They are never rendered, never returned in a body, never placed in a
 * cookie, and never logged.
 *
 * What the token *permits* is not in that session either, so this route no
 * longer decides. It hands the grant to the connection service, which asks
 * Google and stores the answer; this file only turns the outcome into a
 * redirect.
 *
 * Every failure lands on `/welcome`, not `/`. The dashboard redirects a
 * half-configured account to `/welcome` and drops the query string doing it, so
 * a message attached to `/` was written to a URL nobody would ever read.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  const logger = createRootLogger().child({ component: 'auth.callback' });

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');

  const back = (feedback: ConnectionFeedbackCode): NextResponse =>
    NextResponse.redirect(
      new URL(connectionFeedbackPath(feedback), env.NEXT_PUBLIC_SITE_URL),
    );

  if (oauthError !== null) {
    logger.warn('google returned an oauth error', { error: oauthError });
    return back(CONNECTION_FEEDBACK.denied);
  }

  if (code === null) {
    return back(CONNECTION_FEEDBACK.missingCode);
  }

  const db = await createUserScopedClient();
  const { data, error } = await db.auth.exchangeCodeForSession(code);

  if (error !== null || data.session === null) {
    logger.error('code exchange failed', { message: error?.message ?? 'no session returned' });
    return back(CONNECTION_FEEDBACK.failed);
  }

  const session = data.session;
  const providerToken = session.provider_token ?? null;
  const providerRefreshToken = session.provider_refresh_token ?? null;

  if (providerToken === null) {
    // Signed in, but with no usable Classroom grant. Better to say so than to
    // let the student discover it when their first sync fails.
    logger.warn('no provider token in session; classroom access unavailable', {
      userId: session.user.id,
    });
    return back(CONNECTION_FEEDBACK.noProviderToken);
  }

  const connections = createGoogleConnectionService(logger);

  let result: ConnectionResult;
  try {
    result = await connections.storeProviderGrant({
      userId: session.user.id,
      googleSub: (session.user.user_metadata['sub'] as string | undefined) ?? session.user.id,
      accessToken: providerToken,
      // Null means "keep what is stored". Google omits the refresh token on
      // repeat consents, and overwriting with null would break the connection.
      refreshToken: providerRefreshToken,
    });
  } catch (caught) {
    // A storage failure after a successful consent must not become a 500 page
    // at the end of an OAuth flow. Nothing partial was written -- the write is
    // a single statement -- so the student can simply try again.
    logger.error('storing the google connection failed', {
      userId: session.user.id,
      errorCode: isAppError(caught) ? caught.code : 'UNKNOWN',
    });
    return back(CONNECTION_FEEDBACK.failed);
  }

  // The mapping from outcome to destination is pure and lives with the wording,
  // so it can be tested without standing up Supabase and env validation here.
  return NextResponse.redirect(
    new URL(connectionRedirectPath(result.kind), env.NEXT_PUBLIC_SITE_URL),
  );
}
