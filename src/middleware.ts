import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { buildContentSecurityPolicy } from '@/shared/security-headers';

/**
 * Session refresh.
 *
 * Server Components cannot write cookies, so a Supabase session that expires
 * mid-visit cannot be renewed from inside one. Middleware runs before them and
 * can, which is the only reliable place to keep the session alive.
 *
 * `getUser()` rather than `getSession()`: getUser revalidates the JWT with the
 * auth server, so an expired or tampered cookie is rejected here instead of
 * being trusted all the way down to a repository call.
 *
 * That same call now also gates the protected screens. It was already being
 * made and its answer thrown away; using it here means an unauthenticated
 * request never starts rendering a screen it will be redirected away from.
 * Without this the streamed loading state flushes first, so a signed-out
 * visitor sees a skeleton of Today for a moment before landing on sign-in.
 *
 * The page-level `requireSessionUser()` calls stay exactly where they are. This
 * is a redirect for the sake of the visitor, not the authorization boundary;
 * a misconfigured matcher must not be able to expose a screen.
 */

/**
 * Reachable without a session. Everything else redirects to sign-in.
 *
 * `/legal` is public and has to stay that way. The people who most need the
 * privacy policy are the ones deciding whether to sign in at all, and Google's
 * OAuth reviewers never will; a privacy policy behind a login is not a
 * published privacy policy.
 */
const PUBLIC_PATHS = ['/welcome', '/auth', '/api', '/legal'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}
export async function middleware(request: NextRequest) {
  // A fresh nonce per request. Reusing one across requests would let an
  // attacker who learns it inject a script that passes the policy.
  const nonce = crypto.randomUUID().replace(/-/g, '');

  // Forwarded so server components can stamp it onto any script they render.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  // Middleware runs on every request including during a misconfigured boot;
  // failing open here would only turn a config error into a confusing 500.
  const applyCsp = (target: NextResponse): NextResponse => {
    target.headers.set(
      'Content-Security-Policy',
      buildContentSecurityPolicy({
        nonce,
        isDevelopment: process.env.NODE_ENV !== 'production',
        supabaseOrigin: supabaseUrl ?? "'self'",
      }),
    );
    return target;
  };

  if (supabaseUrl === undefined || supabaseAnonKey === undefined) return applyCsp(response);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    });

  const { data, error } = await supabase.auth.getUser();

  if (!isPublic(request.nextUrl.pathname) && (error !== null || data.user === null)) {
    const target = request.nextUrl.clone();
    target.pathname = '/welcome';
    // Any query string belonged to the screen they could not see. Carrying it
    // to sign-in would leak it into history and browser autocomplete for no
    // gain, since nothing on the welcome screen reads it.
    target.search = '';
    // Redirect, not rewrite: the address bar must end up on /welcome, or a
    // refresh silently retries a screen the visitor still cannot open.
    return applyCsp(NextResponse.redirect(target));
  }

  return applyCsp(response);
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation output, and the PWA
    // metadata.
    //
    // The manifest and icons are excluded rather than merely allowed through
    // the session check: a browser fetches them before anyone signs in, and an
    // installed app re-fetches them on launch. Running them through the gate
    // redirected them to /welcome, so the "manifest" a browser received was an
    // HTML page and the app could not be installed at all.
    //
    // maskable-icon is listed separately rather than leaning on the `icon`
    // prefix: a launcher fetches it with no session, and a redirect to /welcome
    // hands Android an HTML page where it expected a PNG. Every entry here is
    // something outside a browser session has to be able to reach.
    //
    // Excluding also skips an auth round trip on every icon request.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|maskable-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
