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
 * makes is filtered by row-level security. This is what backend code uses
 * whenever there is a request to belong to -- including a sync started by the
 * student, which therefore never needs elevated rights to write their own rows.
 *
 * `createServiceRoleClient` bypasses RLS entirely, and has three callers:
 *
 *   - the Google token service and the OAuth callback, which must read
 *     `google_connections`, a table that denies every client role;
 *   - the durable sync worker, which continues a run after the request that
 *     started it is gone. There is no session there to run as, so RLS has no
 *     identity to enforce. See `createWorkerContext` in composition.ts for what
 *     holds the boundary instead: explicit user_id filters, an HMAC-derived
 *     worker token, and an owner-fenced lease per run.
 *
 * Any fourth caller is a bug, and the name is long and this comment is loud for
 * that reason.
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
 *   - the background sync worker (`createWorkerContext`), which runs with no
 *     user session and is bounded by user_id filters, worker-token
 *     authentication and the run's lease instead
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
