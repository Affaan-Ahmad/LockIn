import { NextResponse } from 'next/server';

import { getServerEnv } from '@/config/env';
import { REQUIRED_CLASSROOM_SCOPES } from '@/infrastructure/google/oauth';
import { createUserScopedClient } from '@/infrastructure/supabase/clients';

import { handleRoute } from '../../_lib/handler';

/**
 * Starts the Google consent flow.
 *
 * Two query parameters are doing essential work and neither is optional:
 *
 *   access_type=offline asks for a refresh token. Without it there is no way to
 *   keep Classroom access alive past the first hour.
 *
 *   prompt=consent forces Google to issue a refresh token even when the student
 *   has consented before. Google returns one only on first consent otherwise,
 *   so a student who reconnects after clearing our database would come back
 *   with an access token and no way to renew it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return handleRoute(async () => {
    const env = getServerEnv();
    const db = await createUserScopedClient();

    const { data, error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/auth/callback', env.NEXT_PUBLIC_SITE_URL).toString(),
        scopes: REQUIRED_CLASSROOM_SCOPES.join(' '),
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error !== null || data.url === '') {
      return NextResponse.redirect(new URL('/?connection=failed', env.NEXT_PUBLIC_SITE_URL));
    }

    return NextResponse.redirect(data.url);
  });
}
