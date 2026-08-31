import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { getServerEnv } from '@/config/env';

import type { Database } from './database.types';

export type AppSupabaseClient = SupabaseClient<Database>;

/**
 * Two clients, two privilege levels, and a deliberate asymmetry in how easy
 * each is to reach.
 *
 * `createUserScopedClient` carries the signed-in user's JWT, so every query it
 * makes is filtered by row-level security. This is what almost all backend code
 * uses -- including the sync pipeline, which runs inside an authenticated
 * request and therefore never needs elevated rights to write a user's own rows.
 *
 * `createServiceRoleClient` bypasses RLS entirely. It exists for exactly two
 * callers: the Google token service and the OAuth callback, both of which must
 * read a table that denies every client role. Every other use is a bug, and the
 * name is long and the comment is loud for that reason.
 */

export async function createUserScopedClient(): Promise<AppSupabaseClient> {
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
    );
}

/**
 * DANGEROUS: bypasses row-level security.
 *
 * Permitted callers:
 *   - GoogleTokenService, via SupabaseGoogleConnectionRepository
 *   - the OAuth callback route, to store the initial credential
 *
 * Anything else must use createUserScopedClient. A service-role client that
 * forgets a `.eq('user_id', ...)` filter returns every user's rows, and no
 * policy will stop it.
 */
export function createServiceRoleClient(): AppSupabaseClient {
  const env = getServerEnv();

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // A service-role client must never pick up, persist or refresh a user
      // session: doing so would let request state leak between users.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    });
}
