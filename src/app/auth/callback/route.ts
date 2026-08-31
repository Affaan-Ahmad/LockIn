import { NextResponse } from 'next/server';

import { getServerEnv } from '@/config/env';
import { REQUIRED_CLASSROOM_SCOPES } from '@/infrastructure/google/oauth';
import { createGoogleConnectionRepository, createRootLogger } from '@/infrastructure/composition';
import { createUserScopedClient } from '@/infrastructure/supabase/clients';

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
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  const logger = createRootLogger().child({ component: 'auth.callback' });

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');

  if (oauthError !== null) {
    logger.warn('google returned an oauth error', { error: oauthError });
    return NextResponse.redirect(new URL('/?connection=denied', env.NEXT_PUBLIC_SITE_URL));
  }

  if (code === null) {
    return NextResponse.redirect(new URL('/?connection=missing_code', env.NEXT_PUBLIC_SITE_URL));
  }

  const db = await createUserScopedClient();
  const { data, error } = await db.auth.exchangeCodeForSession(code);

  if (error !== null || data.session === null) {
    logger.error('code exchange failed', { message: error?.message ?? 'no session returned' });
    return NextResponse.redirect(new URL('/?connection=failed', env.NEXT_PUBLIC_SITE_URL));
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
    return NextResponse.redirect(new URL('/?connection=no_provider_token', env.NEXT_PUBLIC_SITE_URL));
  }

  const connections = createGoogleConnectionRepository(logger);

  await connections.upsert({
    userId: session.user.id,
    googleSub: session.user.user_metadata['sub'] as string | undefined ?? session.user.id,
    grantedScopes: [...REQUIRED_CLASSROOM_SCOPES],
    accessToken: providerToken,
    // Supabase does not report the provider token's expiry, so assume Google's
    // standard hour and let the token service refresh early rather than trust
    // a value we were not given.
    accessTokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000),
    // Null means "keep what is stored". Google omits the refresh token on
    // repeat consents, and overwriting with null would break the connection.
    refreshToken: providerRefreshToken,
    });

  logger.info('google classroom connection stored', {
    userId: session.user.id,
    hasRefreshToken: providerRefreshToken !== null,
    });

  return NextResponse.redirect(new URL('/?connection=ok', env.NEXT_PUBLIC_SITE_URL));
}
