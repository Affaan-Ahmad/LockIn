import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/infrastructure/supabase/database.types';

/**
 * Integration harness.
 *
 * These tests run against a real Postgres because the properties they check --
 * unique constraints, CHECK constraints, RLS policies, the single-active-sync
 * index, transactional upserts -- exist only in the database. Asserting them
 * against a fake would assert that the fake is correct, which is not the
 * question.
 *
 * Every test signs in as a genuine user rather than using the service role, so
 * every statement passes through the same RLS policies production uses.
 */

export interface IntegrationConfig {
  readonly url: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
}

export function readIntegrationConfig(): IntegrationConfig | null {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (
    url === undefined ||
    anonKey === undefined ||
    serviceRoleKey === undefined ||
    url === '' ||
    anonKey === '' ||
    serviceRoleKey === ''
  ) {
    return null;
  }

  return { url, anonKey, serviceRoleKey };
}

export type Db = SupabaseClient<Database>;

export interface TestUser {
  readonly id: string;
  readonly email: string;
  /** A client carrying this user's JWT, so RLS applies exactly as in production. */
  readonly db: Db;
}

export class IntegrationHarness {
  readonly admin: Db;
  private readonly createdUserIds: string[] = [];

  constructor(private readonly config: IntegrationConfig) {
    this.admin = createClient<Database>(config.url, config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async createUser(section: string): Promise<TestUser> {
    const email = `it-${crypto.randomUUID()}@example.test`;
    const password = crypto.randomUUID();

    const created = await (
      this.admin as unknown as {
        auth: {
          admin: {
            createUser: (input: {
              email: string;
              password: string;
              email_confirm: boolean;
            }) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
          };
        };
      }
    ).auth.admin.createUser({ email, password, email_confirm: true });

    const userId = created.data.user?.id;
    if (userId === undefined) {
      throw new Error(`failed to create test user: ${JSON.stringify(created.error)}`);
    }
    this.createdUserIds.push(userId);

    const db = createClient<Database>(this.config.url, this.config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error !== null) throw new Error(`sign-in failed: ${signIn.error.message}`);

    // The auth trigger creates user_profiles; the academic profile is ours.
    const profile = await this.admin.from('academic_profiles').insert({
      user_id: userId,
      primary_section: section,
      program_code: 'BCS',
      batch: '4',
      time_zone: 'Asia/Karachi',
    });
    if (profile.error !== null) throw new Error(`profile insert failed: ${profile.error.message}`);

    return { id: userId, email, db };
  }

  /** Deleting the auth user cascades through every table via user_profiles. */
  async cleanup(): Promise<void> {
    const adminAuth = (
      this.admin as unknown as {
        auth: { admin: { deleteUser: (id: string) => Promise<unknown> } };
      }
    ).auth.admin;

    for (const id of this.createdUserIds) {
      await adminAuth.deleteUser(id).catch(() => undefined);
    }
    this.createdUserIds.length = 0;
  }
}

export function assignmentPayload(
  overrides: Partial<{
    source_item_id: string;
    title: string;
    description: string | null;
    due_date_raw: string | null;
    due_time_raw: string | null;
    due_at: string | null;
    due_precision: 'EXACT' | 'DATE_ONLY' | 'NONE';
    source_fingerprint: string;
    source_updated_at: string | null;
  }> = {},
) {
  return {
    source_item_id: 'w1',
    title: 'Assignment 1',
    description: null,
    work_type: 'ASSIGNMENT' as const,
    source_state: 'PUBLISHED' as const,
    max_points: null,
    alternate_link: null,
    source_topic_id: null,
    assignee_mode: null,
    individual_student_ids: null,
    due_date_raw: '2026-03-14',
    due_time_raw: '18:59:00',
    due_at: '2026-03-14T18:59:00.000Z',
    due_precision: 'EXACT' as const,
    source_created_at: null,
    source_updated_at: '2026-02-01T00:00:00.000Z',
    source_fingerprint: 'fp-1',
    ...overrides,
  };
}
