import { NextResponse } from 'next/server';

import { publicBuildInfo } from '@/config/version';

/**
 * What build is serving this request.
 *
 * Public and unauthenticated, deliberately. The whole value is being able to
 * answer "did my change ship?" from a terminal, from a phone, from CI, without
 * a session -- and an endpoint that needs a login cannot be used to diagnose a
 * login that is broken.
 *
 * The commit used to be part of that answer and no longer is. The trade was
 * re-examined in a penetration test and came out the other way: a short SHA
 * pins the deployment to an exact revision, which is a free head start for
 * anyone auditing the source for a weakness -- and the people who genuinely
 * need it are signed in, where the Settings screen already shows it. The
 * version and the environment are what a deployment check actually reads.
 *
 * Left unauthenticated rather than session-gated on purpose. Gating would put
 * an auth round trip, and Supabase's availability, in front of the endpoint
 * whose job is to work when other things do not.
 */

export const runtime = 'nodejs';
// Never cached. A cached build identifier is precisely the wrong thing to
// cache: it would keep reporting the previous deployment.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(publicBuildInfo(), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
