import { NextResponse } from 'next/server';

import { buildInfo } from '@/config/version';

/**
 * What build is serving this request.
 *
 * Public and unauthenticated, deliberately. The whole value is being able to
 * answer "did my change ship?" from a terminal, from a phone, from CI, without
 * a session -- and an endpoint that needs a login cannot be used to diagnose a
 * login that is broken.
 *
 * What that costs: it tells anyone the exact commit running. That is a real,
 * small disclosure -- it narrows which code an attacker is looking at. It is
 * accepted here because the repository is the source of that mapping either
 * way, and because the alternative was people guessing. Nothing else is
 * exposed: not the dependency tree, not the environment variables, not the
 * branch, not the deployment URL.
 */

export const runtime = 'nodejs';
// Never cached. A cached build identifier is precisely the wrong thing to
// cache: it would keep reporting the previous deployment.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(buildInfo(), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
