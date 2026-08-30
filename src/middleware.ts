import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  // Middleware runs on every request including during a misconfigured boot;
  // failing open here would only turn a config error into a confusing 500.
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation output.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
