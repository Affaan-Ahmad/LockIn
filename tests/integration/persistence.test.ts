import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Relevance } from '@/infrastructure/supabase/database.types';

import {
  assignmentPayload,
  IntegrationHarness,
  readIntegrationConfig,
  type TestUser,
} from '../helpers/integration-env';

/**
 * Persistence behaviour that only a real database can demonstrate.
 *
 * Skipped when Supabase credentials are absent so a clean checkout still runs
 * green, but these are not optional: the guarantees below are the ones the
 * architecture leans on, and every one of them lives in SQL rather than in
 * TypeScript.
 *
 * Requires the migrations in supabase/migrations to have been applied.
 */

/**
 * app_acquire_sync_run returns a single `sync_runs` composite rather than a set,
 * so PostgREST sends a bare object where the batch functions send an array.
 * Normalising here keeps the tests honest about which shape they get.
 */
function firstRow<T>(data: T[] | T | null): T {
  if (data === null) throw new Error('expected a row, got null');
  const row = Array.isArray(data) ? data[0] : data;
  if (row === undefined) throw new Error('expected a row, got an empty set');
  return row;
}

const config = readIntegrationConfig();
const describeIntegration = config === null ? describe.skip : describe;

describeIntegration('persistence invariants', () => {
  let harness: IntegrationHarness;
  let alice: TestUser;
  let bob: TestUser;
  let aliceCourseId: string;

  beforeAll(async () => {
    harness = new IntegrationHarness(config!);
    alice = await harness.createUser('G');
    bob = await harness.createUser('B');

    const { data, error } = await alice.db.rpc('app_upsert_courses', {
      p_user_id: alice.id,
      p_items: [
        {
          source_course_id: 'gc-1',
          name: 'Data Structures',
          section: 'BCS-4',
          description_heading: null,
          room: null,
          course_state: 'ACTIVE',
          alternate_link: null,
          source_created_at: null,
          source_updated_at: null,
        },
      ],
      p_synced_at: new Date().toISOString(),
    });

    if (error !== null) throw new Error(`course setup failed: ${error.message}`);
    const course = data?.[0];
    if (course === undefined) throw new Error('course setup returned no row');
    aliceCourseId = course.id;

    // Nothing is surfaced until the student opts in, so the fixture course must
    // be tracked before any feed assertion below can pass.
    const tracked = await alice.db.rpc('app_set_course_tracking', {
      p_user_id: alice.id,
      p_items: [{ course_id: aliceCourseId, is_tracked: true }],
    });
    if (tracked.error !== null) throw new Error('tracking setup failed: ' + tracked.error.message);
  }, 60_000);

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('idempotency', () => {
    it('does not duplicate coursework when the same sync runs twice', async () => {
      const payload = [assignmentPayload({ source_item_id: 'dup-1' })];
      const at = new Date().toISOString();

      const first = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: payload,
        p_synced_at: at,
      });
      const second = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: payload,
        p_synced_at: at,
      });

      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect(first.data![0]!.created).toBe(true);
      expect(second.data![0]!.created).toBe(false);
      // Identical fingerprint means Google changed nothing.
      expect(second.data![0]!.changed).toBe(false);
      expect(second.data![0]!.assignment_id).toBe(first.data![0]!.assignment_id);
    });

    it('reports a genuine change when the fingerprint differs', async () => {
      await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'chg-1', source_fingerprint: 'fp-a' })],
        p_synced_at: new Date().toISOString(),
      });

      const updated = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'chg-1',
            title: 'Assignment 1 (revised)',
            source_fingerprint: 'fp-b',
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });

      expect(updated.data![0]!.changed).toBe(true);
    });

    it('leaves the incremental watermark untouched when courses are refreshed', async () => {
      const watermark = '2026-02-20T00:00:00.000Z';
      await alice.db
        .from('courses')
        .update({ coursework_watermark: watermark })
        .eq('id', aliceCourseId);

      await alice.db.rpc('app_upsert_courses', {
        p_user_id: alice.id,
        p_items: [
          {
            source_course_id: 'gc-1',
            name: 'Data Structures (renamed)',
            section: 'BCS-4',
            description_heading: null,
            room: null,
            course_state: 'ACTIVE',
            alternate_link: null,
            source_created_at: null,
            source_updated_at: null,
          },
        ],
        p_synced_at: new Date().toISOString(),
      });

      const { data } = await alice.db
        .from('courses')
        .select('name, coursework_watermark')
        .eq('id', aliceCourseId)
        .single();

      expect(data!.name).toBe('Data Structures (renamed)');
      // Resetting it would force a full re-read of every course, forever.
      expect(new Date(data!.coursework_watermark!).toISOString()).toBe(watermark);
    });
  });

  describe('database-enforced correctness', () => {
    it('rejects a deadline that claims more precision than it has', async () => {
      const { error } = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'bad-precision',
            due_precision: 'EXACT',
            due_time_raw: null,
            due_at: null,
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/due_precision_coherent/);
    });

    it('rejects a low-confidence attempt to hide coursework', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'conf-1' })],
        p_synced_at: new Date().toISOString(),
      });
      const assignmentId = created.data![0]!.assignment_id;

      const { error } = await alice.db.rpc('app_upsert_classifications', {
        p_user_id: alice.id,
        p_rows: [
          {
            assignment_id: assignmentId,
            relevance: 'NOT_RELEVANT',
            confidence: 0.4,
            decided_by_rule: 'TEST',
            reason: 'timid guess',
            evidence: [],
            conflicted: false,
            ruleset_version: 'test',
            input_fingerprint: 'x',
            scope_type: 'SPECIFIC_SECTIONS',
            scope_sections: ['b'],
            scope_rule: 'EXPLICIT_SECTION_WORD',
            scope_confidence: 0.95,
          },
        ],
      });

      // The schema refuses to store a timid NOT_RELEVANT. A rule bug becomes a
      // write failure instead of a hidden assignment.
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/hiding_requires_confidence/);
    });

    it('maintains due_sort_at for a date-only deadline', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'dateonly-1',
            due_precision: 'DATE_ONLY',
            due_time_raw: null,
            due_at: null,
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });

      const { data } = await alice.db
        .from('courses')
        .select('id')
        .eq('id', aliceCourseId)
        .single();
      expect(data).not.toBeNull();

      const row = await alice.db
        .from('assignments')
        .select('due_sort_at, due_at')
        .eq('id', created.data![0]!.assignment_id)
        .single();

      const value = row.data as unknown as { due_sort_at: string; due_at: string | null };
      // Sorts at the start of its UTC day, and still carries no instant.
      expect(new Date(value.due_sort_at).toISOString()).toBe('2099-03-14T00:00:00.000Z');
      expect(value.due_at).toBeNull();
    });
  });

  describe('manual overrides', () => {
    it('survives a re-sync and wins in the read model', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({ source_item_id: 'ovr-1', title: 'Assignment 3 - Section B' }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      const assignmentId = created.data![0]!.assignment_id;

      await alice.db.rpc('app_upsert_classifications', {
        p_user_id: alice.id,
        p_rows: [
          {
            assignment_id: assignmentId,
            relevance: 'NOT_RELEVANT',
            confidence: 0.85,
            decided_by_rule: 'SECTION_SCOPE',
            reason: 'targets section B',
            evidence: [],
            conflicted: false,
            ruleset_version: 'test',
            input_fingerprint: 'fp-1',
            scope_type: 'SPECIFIC_SECTIONS',
            scope_sections: ['b'],
            scope_rule: 'EXPLICIT_SECTION_WORD',
            scope_confidence: 0.95,
          },
        ],
      });

      await alice.db.from('classification_overrides').upsert(
        {
          user_id: alice.id,
          assignment_id: assignmentId,
          relevance: 'RELEVANT',
          note: 'my section was added late',
        },
        { onConflict: 'user_id,assignment_id' },
      );

      // A full re-sync: source data rewritten, classification rewritten.
      await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'ovr-1',
            title: 'Assignment 3 - Section B',
            source_fingerprint: 'fp-2',
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      await alice.db.rpc('app_upsert_classifications', {
        p_user_id: alice.id,
        p_rows: [
          {
            assignment_id: assignmentId,
            relevance: 'NOT_RELEVANT',
            confidence: 0.85,
            decided_by_rule: 'SECTION_SCOPE',
            reason: 'targets section B',
            evidence: [],
            conflicted: false,
            ruleset_version: 'test',
            input_fingerprint: 'fp-2',
            scope_type: 'SPECIFIC_SECTIONS',
            scope_sections: ['b'],
            scope_rule: 'EXPLICIT_SECTION_WORD',
            scope_confidence: 0.95,
          },
        ],
      });

      const override = await alice.db
        .from('classification_overrides')
        .select('relevance')
        .eq('assignment_id', assignmentId)
        .single();

      expect(override.data!.relevance).toBe('RELEVANT');

      const upcoming = await alice.db.rpc('app_upcoming_assignments', {
        p_user_id: alice.id,
        p_to: '2100-01-01T00:00:00Z',
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: true,
        p_limit: 100,
      });

      const row = upcoming.data!.find((item) => item.assignment_id === assignmentId);
      // The student's decision, not the classifier's, is what the read model
      // returns -- and the resolution happens in SQL so every consumer agrees.
      expect(row!.effective_relevance).toBe('RELEVANT');
      expect(row!.has_manual_override).toBe(true);
    });
  });

  describe('disappearance reconciliation', () => {
    it('requires two consecutive complete listings before concluding removal', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'gone-1' })],
        p_synced_at: new Date().toISOString(),
      });
      const assignmentId = created.data![0]!.assignment_id;

      const reconcile = async () =>
        alice.db.rpc('app_reconcile_missing_assignments', {
          p_user_id: alice.id,
          p_course_id: aliceCourseId,
          // Deliberately excludes gone-1 but keeps the other fixtures present.
          p_seen_item_ids: ['dup-1', 'chg-1', 'conf-1', 'dateonly-1', 'ovr-1'],
          p_at: new Date().toISOString(),
          p_threshold: 2,
        });

      const readStatus = async () => {
        const row = await alice.db
          .from('assignments')
          .select('lifecycle_status, missing_streak')
          .eq('id', assignmentId)
          .single();
        return row.data as unknown as { lifecycle_status: string; missing_streak: number };
      };

      await reconcile();
      const afterFirst = await readStatus();
      // One bad response is not proof. The item stays visible.
      expect(afterFirst.lifecycle_status).toBe('SOURCE_MISSING');

      await reconcile();
      expect((await readStatus()).lifecycle_status).toBe('SOURCE_REMOVED');
    });

    it('clears the missing streak when the item comes back', async () => {
      await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'gone-1', source_fingerprint: 'fp-back' })],
        p_synced_at: new Date().toISOString(),
      });

      const row = await alice.db
        .from('assignments')
        .select('lifecycle_status, missing_streak')
        .eq('user_id', alice.id)
        .eq('source_item_id', 'gone-1')
        .single();

      const value = row.data as unknown as { lifecycle_status: string; missing_streak: number };
      expect(value.lifecycle_status).toBe('ACTIVE');
      expect(value.missing_streak).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('permits only one running sync per user', async () => {
      const first = await alice.db.rpc('app_acquire_sync_run', {
        p_user_id: alice.id,
        p_trigger: 'MANUAL',
        p_mode: 'FULL',
        p_lease_ttl_seconds: 900,
      });
      expect(first.error).toBeNull();

      const second = await alice.db.rpc('app_acquire_sync_run', {
        p_user_id: alice.id,
        p_trigger: 'MANUAL',
        p_mode: 'FULL',
        p_lease_ttl_seconds: 900,
      });

      expect(second.error).not.toBeNull();
      expect(second.error!.message).toMatch(/already running/i);

      await alice.db.rpc('app_finalize_sync_run', {
        p_sync_run_id: firstRow(first.data).id,
        p_status: 'SUCCESS',
        p_counts: {},
        p_error_summary: null,
      });
    });

    it('reclaims a lease whose heartbeat has expired', async () => {
      const stale = await alice.db.rpc('app_acquire_sync_run', {
        p_user_id: alice.id,
        p_trigger: 'MANUAL',
        p_mode: 'FULL',
        p_lease_ttl_seconds: 900,
      });

      // Simulate a process that died without finalising.
      await harness.admin
        .from('sync_runs')
        .update({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', firstRow(stale.data).id);

      const next = await alice.db.rpc('app_acquire_sync_run', {
        p_user_id: alice.id,
        p_trigger: 'MANUAL',
        p_mode: 'FULL',
        p_lease_ttl_seconds: 900,
      });

      expect(next.error).toBeNull();

      // The dead run is recorded as ABANDONED rather than deleted, so the
      // failed attempt is still visible when debugging.
      const abandoned = await alice.db
        .from('sync_runs')
        .select('status')
        .eq('id', firstRow(stale.data).id)
        .single();
      expect(abandoned.data!.status).toBe('ABANDONED');

      await alice.db.rpc('app_finalize_sync_run', {
        p_sync_run_id: firstRow(next.data).id,
        p_status: 'SUCCESS',
        p_counts: {},
        p_error_summary: null,
      });
    });
  });

  describe('course tracking', () => {
    let untrackedCourseId: string;

    beforeAll(async () => {
      const { data, error } = await alice.db.rpc('app_upsert_courses', {
        p_user_id: alice.id,
        p_items: [
          {
            source_course_id: 'gc-old',
            name: 'Old Fall 2025 Class',
            section: null,
            description_heading: null,
            room: null,
            course_state: 'ACTIVE',
            alternate_link: null,
            source_created_at: null,
            source_updated_at: null,
          },
        ],
        p_synced_at: new Date().toISOString(),
      });
      if (error !== null) throw new Error('untracked course setup failed: ' + error.message);
      untrackedCourseId = data[0]!.id;

      await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: untrackedCourseId,
        p_items: [assignmentPayload({ source_item_id: 'old-1', title: 'Ancient homework' })],
        p_synced_at: new Date().toISOString(),
      });
    }, 30_000);

    it('lists every discovered course, tracked or not', async () => {
      const { data, error } = await alice.db.rpc('app_list_discovered_courses', {
        p_user_id: alice.id,
      });

      expect(error).toBeNull();
      const byId = new Map((data ?? []).map((row) => [row.course_id, row]));
      // Discovery must show the untracked ones: that is the screen's purpose.
      expect(byId.get(aliceCourseId)?.is_tracked).toBe(true);
      expect(byId.get(untrackedCourseId)?.is_tracked).toBe(false);
    });

    it('distinguishes not-chosen-yet from chosen-and-declined', async () => {
      const before = await alice.db.rpc('app_list_discovered_courses', { p_user_id: alice.id });
      const undecided = (before.data ?? []).find((row) => row.course_id === untrackedCourseId);
      expect(undecided?.decided_at).toBeNull();

      await alice.db.rpc('app_set_course_tracking', {
        p_user_id: alice.id,
        p_items: [{ course_id: untrackedCourseId, is_tracked: false }],
      });

      const after = await alice.db.rpc('app_list_discovered_courses', { p_user_id: alice.id });
      const declined = (after.data ?? []).find((row) => row.course_id === untrackedCourseId);
      expect(declined?.is_tracked).toBe(false);
      // Now it carries a decision, which is what lets a client stop prompting.
      expect(declined?.decided_at).not.toBeNull();
    });

    it('keeps untracked coursework out of the deadline feed', async () => {
      const { data } = await alice.db.rpc('app_upcoming_assignments', {
        p_user_id: alice.id,
        p_to: '2100-01-01T00:00:00Z',
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: true,
        p_limit: 100,
      });

      expect((data ?? []).map((row) => row.title)).not.toContain('Ancient homework');
    });

    it('brings the course into the feed the moment it is tracked', async () => {
      await alice.db.rpc('app_set_course_tracking', {
        p_user_id: alice.id,
        p_items: [{ course_id: untrackedCourseId, is_tracked: true }],
      });

      const { data } = await alice.db.rpc('app_upcoming_assignments', {
        p_user_id: alice.id,
        p_to: '2100-01-01T00:00:00Z',
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: true,
        p_limit: 100,
      });

      expect((data ?? []).map((row) => row.title)).toContain('Ancient homework');

      // Restore, so later assertions see the intended fixture state.
      await alice.db.rpc('app_set_course_tracking', {
        p_user_id: alice.id,
        p_items: [{ course_id: untrackedCourseId, is_tracked: false }],
      });
    });

    it('refuses to track a course belonging to another student', async () => {
      const { error } = await bob.db.rpc('app_set_course_tracking', {
        p_user_id: alice.id,
        p_items: [{ course_id: aliceCourseId, is_tracked: true }],
      });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/cross-user access denied/i);
    });
  });

  describe('assignments with no due date', () => {
    let undatedId: string;

    beforeAll(async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'nodue-1',
            title: 'Reading list',
            due_precision: 'NONE',
            due_date_raw: null,
            due_time_raw: null,
            due_at: null,
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      if (created.error !== null) throw new Error(created.error.message);
      undatedId = created.data[0]!.assignment_id;
    }, 30_000);

    it('stores the assignment with a genuinely null deadline', async () => {
      const row = await alice.db
        .from('assignments')
        .select('due_at, due_date_raw, due_sort_at, due_precision')
        .eq('id', undatedId)
        .single();

      // Preserved, with nothing invented: no 23:59, no today's date.
      expect(row.data!.due_at).toBeNull();
      expect(row.data!.due_date_raw).toBeNull();
      expect(row.data!.due_sort_at).toBeNull();
      expect(row.data!.due_precision).toBe('NONE');
    });

    it('keeps it out of the deadline feed', async () => {
      const { data } = await alice.db.rpc('app_upcoming_assignments', {
        p_user_id: alice.id,
        p_to: null,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: true,
        p_limit: 500,
      });

      expect((data ?? []).map((row) => row.assignment_id)).not.toContain(undatedId);
    });

    it('returns it from the undated query instead', async () => {
      const { data, error } = await alice.db.rpc('app_undated_assignments', {
        p_user_id: alice.id,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_limit: 100,
      });

      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.assignment_id)).toContain(undatedId);
    });
  });

  describe('upcoming / overdue / undated partition', () => {
    it('places every visible assignment in exactly one bucket', async () => {
      const args = {
        p_user_id: alice.id,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'] as Relevance[],
        p_include_submitted: true,
        p_limit: 500,
      };

      const upcoming = await alice.db.rpc('app_upcoming_assignments', { ...args, p_to: null });
      const overdue = await alice.db.rpc('app_overdue_assignments', { ...args, p_since: null });
      const undated = await alice.db.rpc('app_undated_assignments', {
        p_user_id: alice.id,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_limit: 500,
      });

      expect(upcoming.error).toBeNull();
      expect(overdue.error).toBeNull();
      expect(undated.error).toBeNull();

      const ids = [
        ...(upcoming.data ?? []).map((r) => r.assignment_id),
        ...(overdue.data ?? []).map((r) => r.assignment_id),
        ...(undated.data ?? []).map((r) => r.assignment_id),
      ];

      // The partition is the point: an assignment in two tabs is a duplicate,
      // and one in none has silently vanished.
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('puts a past deadline in overdue and a future one in upcoming', async () => {
      const past = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'overdue-1',
            title: 'Missed lab',
            due_date_raw: '2020-01-01',
            due_time_raw: '18:59:00',
            due_at: '2020-01-01T18:59:00.000Z',
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      expect(past.error).toBeNull();
      const pastId = past.data![0]!.assignment_id;

      const future = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'future-1',
            title: 'Upcoming lab',
            due_date_raw: '2099-01-01',
            due_time_raw: '18:59:00',
            due_at: '2099-01-01T18:59:00.000Z',
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      const futureId = future.data![0]!.assignment_id;

      const args = {
        p_user_id: alice.id,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'] as Relevance[],
        p_include_submitted: true,
        p_limit: 500,
      };
      const overdue = await alice.db.rpc('app_overdue_assignments', { ...args, p_since: null });
      const upcoming = await alice.db.rpc('app_upcoming_assignments', { ...args, p_to: null });

      expect((overdue.data ?? []).map((r) => r.assignment_id)).toContain(pastId);
      expect((overdue.data ?? []).map((r) => r.assignment_id)).not.toContain(futureId);
      expect((upcoming.data ?? []).map((r) => r.assignment_id)).toContain(futureId);
      expect((upcoming.data ?? []).map((r) => r.assignment_id)).not.toContain(pastId);
    });

    it('does not call a date-only deadline overdue on the day it is due', async () => {
      // due_sort_at puts a date-only item at 00:00 UTC, so a naive comparison
      // marks it overdue while the student still has the whole day.
      const today = new Date().toISOString().slice(0, 10);
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'dateonly-today',
            title: 'Due today, no time given',
            due_precision: 'DATE_ONLY',
            due_date_raw: today,
            due_time_raw: null,
            due_at: null,
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      const id = created.data![0]!.assignment_id;

      const overdue = await alice.db.rpc('app_overdue_assignments', {
        p_user_id: alice.id,
        p_since: null,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: true,
        p_limit: 500,
      });

      expect((overdue.data ?? []).map((r) => r.assignment_id)).not.toContain(id);
    });
  });

  describe('section scope persistence', () => {
    it('rejects an unrestricted assignment marked not relevant', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'scope-1' })],
        p_synced_at: new Date().toISOString(),
      });

      const { error } = await alice.db.rpc('app_upsert_classifications', {
        p_user_id: alice.id,
        p_rows: [
          {
            assignment_id: created.data![0]!.assignment_id,
            relevance: 'NOT_RELEVANT',
            confidence: 0.95,
            decided_by_rule: 'SECTION_SCOPE',
            reason: 'bug',
            evidence: [],
            conflicted: false,
            ruleset_version: 'test',
            input_fingerprint: 'x',
            scope_type: 'ALL_SECTIONS',
            scope_sections: [],
            scope_rule: 'NO_SECTION_RESTRICTION_FOUND',
            scope_confidence: 1,
          },
        ],
      });

      // Coursework for everyone can never be hidden from anyone. ALL_SECTIONS
      // is the default scope for unlabelled work, so a bug pairing the two
      // would hide most of a shared course from every student.
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/all_sections_is_relevant/);
    });

    it('rejects a specific scope with no sections listed', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'scope-2' })],
        p_synced_at: new Date().toISOString(),
      });

      const { error } = await alice.db.rpc('app_upsert_classifications', {
        p_user_id: alice.id,
        p_rows: [
          {
            assignment_id: created.data![0]!.assignment_id,
            relevance: 'RELEVANT',
            confidence: 0.9,
            decided_by_rule: 'SECTION_SCOPE',
            reason: 'bug',
            evidence: [],
            conflicted: false,
            ruleset_version: 'test',
            input_fingerprint: 'x',
            scope_type: 'SPECIFIC_SECTIONS',
            scope_sections: [],
            scope_rule: 'EXPLICIT_SECTION_WORD',
            scope_confidence: 0.95,
          },
        ],
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/scope_coherent/);
    });
  });

  describe('submission upsert', () => {
    // Covers app_upsert_submissions, which migration 0009 rewrote when the
    // grade columns were dropped. It had no integration coverage at the point
    // it was replaced, which meant the only evidence the rewrite worked was
    // reading it.

    async function createAssignment(sourceId: string): Promise<string> {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: sourceId })],
        p_synced_at: new Date().toISOString(),
      });
      expect(created.error).toBeNull();
      return created.data![0]!.assignment_id;
    }

    function submissionPayload(sourceItemId: string, overrides: Record<string, unknown> = {}) {
      return {
        source_submission_id: `sub-${sourceItemId}`,
        source_item_id: sourceItemId,
        state: 'TURNED_IN' as const,
        late: false,
        alternate_link: null,
        source_created_at: null,
        source_updated_at: null,
        ...overrides,
      };
    }

    it('records submission state against the right assignment', async () => {
      const assignmentId = await createAssignment('sub-target-1');

      const { data, error } = await alice.db.rpc('app_upsert_submissions', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [submissionPayload('sub-target-1')],
        p_synced_at: new Date().toISOString(),
      });

      expect(error).toBeNull();
      expect(data).toBe(1);

      const stored = await alice.db
        .from('submissions')
        .select('assignment_id, state, late')
        .eq('assignment_id', assignmentId)
        .maybeSingle();

      expect(stored.data?.state).toBe('TURNED_IN');
      expect(stored.data?.late).toBe(false);
    });

    it('updates an existing submission rather than duplicating it', async () => {
      const assignmentId = await createAssignment('sub-target-2');
      const args = {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_synced_at: new Date().toISOString(),
      };

      await alice.db.rpc('app_upsert_submissions', {
        ...args,
        p_items: [submissionPayload('sub-target-2', { state: 'CREATED', late: false })],
      });
      const second = await alice.db.rpc('app_upsert_submissions', {
        ...args,
        p_items: [submissionPayload('sub-target-2', { state: 'TURNED_IN', late: true })],
      });
      expect(second.error).toBeNull();

      const rows = await alice.db
        .from('submissions')
        .select('state, late')
        .eq('assignment_id', assignmentId);

      // One row, carrying the newer state. A second row here would make a
      // handed-in assignment look outstanding depending on which one was read.
      expect(rows.data ?? []).toHaveLength(1);
      expect(rows.data![0]!.state).toBe('TURNED_IN');
      expect(rows.data![0]!.late).toBe(true);
    });

    it('drops a submission for coursework that was never ingested', async () => {
      const { data, error } = await alice.db.rpc('app_upsert_submissions', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [submissionPayload('never-ingested-item')],
        p_synced_at: new Date().toISOString(),
      });

      // Silently skipped, not an error: without the assignment row there is
      // nothing for the submission to describe, and failing the batch would
      // let one orphan abort a whole course's sync.
      expect(error).toBeNull();
      expect(data).toBe(0);
    });

    it('hides a submitted assignment from the upcoming feed', async () => {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: 'sub-target-3',
            due_date_raw: '2099-06-01',
            due_time_raw: '18:59:00',
            due_at: '2099-06-01T18:59:00.000Z',
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      const id = created.data![0]!.assignment_id;

      await alice.db.rpc('app_upsert_submissions', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [submissionPayload('sub-target-3', { state: 'TURNED_IN' })],
        p_synced_at: new Date().toISOString(),
      });

      const upcoming = await alice.db.rpc('app_upcoming_assignments', {
        p_user_id: alice.id,
        p_to: null,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: false,
        p_limit: 500,
      });

      // The whole reason the submissions scope is requested at all: work the
      // student has already handed in stops competing for their attention.
      expect((upcoming.data ?? []).map((r) => r.assignment_id)).not.toContain(id);
    });

    it('refuses a submission write for another student', async () => {
      const { error } = await bob.db.rpc('app_upsert_submissions', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [submissionPayload('sub-target-1')],
        p_synced_at: new Date().toISOString(),
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/cross-user access denied/i);
    });
  });

  describe('hiding an assignment', () => {
    async function createOverdue(sourceId: string): Promise<string> {
      const created = await alice.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [
          assignmentPayload({
            source_item_id: sourceId,
            title: 'Missed and dealt with',
            due_date_raw: '2020-02-02',
            due_time_raw: '18:59:00',
            due_at: '2020-02-02T18:59:00.000Z',
          }),
        ],
        p_synced_at: new Date().toISOString(),
      });
      expect(created.error).toBeNull();
      return created.data![0]!.assignment_id;
    }

    async function overdueIds(): Promise<string[]> {
      const { data } = await alice.db.rpc('app_overdue_assignments', {
        p_user_id: alice.id,
        p_since: null,
        p_relevance: ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'],
        p_include_submitted: true,
        p_limit: 500,
      });
      return (data ?? []).map((r) => r.assignment_id);
    }

    it('removes a hidden assignment from the overdue feed and restores it', async () => {
      const id = await createOverdue('hide-1');
      expect(await overdueIds()).toContain(id);

      const hidden = await alice.db.rpc('app_set_assignment_ignored', {
        p_user_id: alice.id,
        p_assignment_id: id,
        p_ignored: true,
        p_note: null,
      });
      expect(hidden.error).toBeNull();
      expect(await overdueIds()).not.toContain(id);

      const restored = await alice.db.rpc('app_set_assignment_ignored', {
        p_user_id: alice.id,
        p_assignment_id: id,
        p_ignored: false,
        p_note: null,
      });
      expect(restored.error).toBeNull();

      // The point of the whole feature: hiding is reversible, and what comes
      // back is the same row, not a rebuilt approximation of it.
      expect(await overdueIds()).toContain(id);
    });

    it('still lists a hidden assignment on the hidden screen', async () => {
      const id = await createOverdue('hide-2');
      await alice.db.rpc('app_set_assignment_ignored', {
        p_user_id: alice.id,
        p_assignment_id: id,
        p_ignored: true,
        p_note: 'submitted late in person',
      });

      const { data, error } = await alice.db.rpc('app_ignored_assignments', {
        p_user_id: alice.id,
        p_limit: 500,
      });

      expect(error).toBeNull();
      // Hidden must never mean gone. An item with no way back would be data
      // loss the student performed on themselves.
      expect((data ?? []).map((r) => r.assignment_id)).toContain(id);
    });

    it('does not record hiding as a decision about relevance', async () => {
      const id = await createOverdue('hide-3');
      await alice.db.rpc('app_set_assignment_ignored', {
        p_user_id: alice.id,
        p_assignment_id: id,
        p_ignored: true,
        p_note: null,
      });

      const { data } = await alice.db
        .from('classification_overrides')
        .select('assignment_id')
        .eq('user_id', alice.id)
        .eq('assignment_id', id);

      // "Stop showing me this" is not "this was for another section". Writing
      // an override here would poison the record the classifier will one day
      // learn from.
      expect(data ?? []).toHaveLength(0);
    });

    it('treats hiding twice and restoring twice as no-ops', async () => {
      const id = await createOverdue('hide-4');

      for (const ignored of [true, true, false, false]) {
        const { error } = await alice.db.rpc('app_set_assignment_ignored', {
          p_user_id: alice.id,
          p_assignment_id: id,
          p_ignored: ignored,
          p_note: null,
        });
        // A double tap on a phone must not produce a failure dialog.
        expect(error).toBeNull();
      }

      expect(await overdueIds()).toContain(id);
    });

    it('refuses to hide an assignment belonging to another student', async () => {
      const id = await createOverdue('hide-5');

      const { error } = await bob.db.rpc('app_set_assignment_ignored', {
        p_user_id: alice.id,
        p_assignment_id: id,
        p_ignored: true,
        p_note: null,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/cross-user access denied/i);
    });

    it('does not let a student see what another student hid', async () => {
      const { data } = await bob.db
        .from('ignored_assignments')
        .select('assignment_id')
        .eq('user_id', alice.id);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe('row level security', () => {
    it('hides one student coursework from another', async () => {
      const { data } = await bob.db
        .from('assignments')
        .select('id')
        .eq('user_id', alice.id);

      // Not an error, an empty set: RLS filters rather than rejecting, which is
      // what makes a forgotten WHERE clause safe rather than fatal.
      expect(data ?? []).toHaveLength(0);
    });

    it('hides one student classifications and overrides from another', async () => {
      const classifications = await bob.db
        .from('assignment_classifications')
        .select('assignment_id')
        .eq('user_id', alice.id);
      const overrides = await bob.db
        .from('classification_overrides')
        .select('assignment_id')
        .eq('user_id', alice.id);

      expect(classifications.data ?? []).toHaveLength(0);
      expect(overrides.data ?? []).toHaveLength(0);
    });

    it('refuses a cross-user write attempt', async () => {
      const { error } = await bob.db.rpc('app_upsert_assignments', {
        p_user_id: alice.id,
        p_course_id: aliceCourseId,
        p_items: [assignmentPayload({ source_item_id: 'evil-1' })],
        p_synced_at: new Date().toISOString(),
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/cross-user access denied/i);
    });

    it('denies every client role access to stored Google credentials', async () => {
      const { data, error } = await alice.db
        .from('google_connections')
        .select('user_id')
        .eq('user_id', alice.id);

      // RLS is enabled with no policies, so the table is unreachable even to
      // its own owner through the API. Only the service role can read it.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });

    it('does not let a student see another student sync errors', async () => {
      const { data } = await bob.db.from('sync_errors').select('id').eq('user_id', alice.id);
      expect(data ?? []).toHaveLength(0);
    });

    it('does not let a student see another student subject selection', async () => {
      const { data } = await bob.db
        .from('course_tracking')
        .select('course_id')
        .eq('user_id', alice.id);
      expect(data ?? []).toHaveLength(0);
    });
  });
});
