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
 *
 * `/offline` is public because being signed out and being offline are not
 * mutually exclusive, and a redirect to sign-in is the one response guaranteed
 * not to work when there is no connection. The page carries no data.
 */
const PUBLIC_PATHS = ['/welcome', '/auth', '/api', '/legal', '/offline'];

/**
 * Where the visitor was heading when they were bounced to sign-in.
 *
 * A cookie rather than a `?next=` parameter, for two reasons. It never appears
 * in the address bar, so it cannot end up in history or browser autocomplete --
 * which was the stated reason the query string used to be discarded here, and
 * that reason was right. And because nothing outside this file can write it,
 * the value cannot be chosen by whoever crafted the link.
 *
 * Short-lived on purpose. This is a breadcrumb for the next minute or two, not
 * a preference; a stale one would teleport somebody days later.
 */
const RETURN_COOKIE = 'lockin_return_to';
const RETURN_MAX_AGE_SECONDS = 600;

/**
 * Whether a stored destination is safe to send somebody to.
 *
 * The value is written from `nextUrl.pathname`, so it is already a path on this
 * origin -- but `//evil.example` is also a path, and a browser reads a
 * protocol-relative redirect as another origin. That single check is the
 * difference between a returning visitor and an open redirect.
 */
function isSafeReturnPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  // Backslashes are normalised to slashes by some browsers, so `/\evil.example`
  // is the same trick wearing a different hat.
  if (value.startsWith('/\\')) return false;
  return true;
}

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

  const signedOut = error !== null || data.user === null;

  if (!isPublic(request.nextUrl.pathname) && signedOut) {
    const target = request.nextUrl.clone();
    const intended = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    target.pathname = '/welcome';
    // The query string still does not travel in the URL: carrying it to
    // sign-in would leak it into history and browser autocomplete, and nothing
    // on the welcome screen reads it. It travels in the cookie below instead,
    // which is where the destination belongs -- the path used to be dropped
    // here too, silently, so a shared link to one assignment landed everybody
    // on Today with no way to tell that anything had been lost.
    target.search = '';

    // Redirect, not rewrite: the address bar must end up on /welcome, or a
    // refresh silently retries a screen the visitor still cannot open.
    const redirect = applyCsp(NextResponse.redirect(target));

    if (isSafeReturnPath(intended) && intended !== '/') {
      redirect.cookies.set(RETURN_COOKIE, intended, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: RETURN_MAX_AGE_SECONDS,
      });
    }

    return redirect;
  }

  /**
   * Back again, with a session, at the place sign-in always lands.
   *
   * The OAuth callback finishes on `/`, so that is the one path worth checking
   * -- and checking only `/` is what keeps this from interfering with ordinary
   * navigation. The cookie is cleared on the way through, so it fires once.
   *
   * Known limitation, accepted deliberately: an account that has not finished
   * onboarding is sent to the deep link rather than through setup, because
   * middleware cannot read setup state without a database call on every
   * request. The result is a first-run that starts on an empty screen with the
   * navigation intact, not a broken account -- and Today still routes them into
   * onboarding the moment they tap it.
   */
  if (!signedOut && request.nextUrl.pathname === '/') {
    const stored = request.cookies.get(RETURN_COOKIE)?.value;

    if (stored !== undefined && isSafeReturnPath(stored) && stored !== '/') {
      const target = request.nextUrl.clone();
      const [pathname, search] = stored.split('?');
      target.pathname = pathname ?? '/';
      target.search = search === undefined ? '' : `?${search}`;

      const resume = applyCsp(NextResponse.redirect(target));
      resume.cookies.delete(RETURN_COOKIE);
      return resume;
    }
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
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon|apple-icon|maskable-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
