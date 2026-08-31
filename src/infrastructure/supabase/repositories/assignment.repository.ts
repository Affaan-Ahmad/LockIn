import 'server-only';

import type {
  AssignmentRepository,
  AssignmentUpsertResult,
  OverdueQuery,
  UndatedAssignment,
  UndatedQuery,
  UpcomingAssignment,
  UpcomingQuery,
} from '@/application/ports/repositories';
import {
  calendarDateToIso,
  clockTimeToIso,
  type Deadline,
} from '@/domain/assignment/deadline';
import {
  MISSING_STREAK_THRESHOLD,
  type ListingCompleteness,
} from '@/domain/assignment/lifecycle';
import type { AssignmentSourceRecord } from '@/domain/assignment/types';
import { fingerprintAssignment } from '@/infrastructure/google/classroom.mapper';
import { chunk } from '@/shared/concurrency';
import { PersistenceError } from '@/shared/errors';

import type { AppSupabaseClient } from '../clients';
import type {
  AssignmentUpsertPayload,
  UndatedAssignmentRow,
  UpcomingAssignmentRow,
} from '../database.types';
import { toDbTimestamp, translatePostgrestError } from './shared';

/**
 * Batch size for the upsert RPC.
 *
 * Large enough that a typical course is a single call, small enough that the
 * jsonb payload for a pathological course does not become a multi-megabyte
 * request body.
 */
const UPSERT_BATCH_SIZE = 200;

export class SupabaseAssignmentRepository implements AssignmentRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  /**
   * Idempotent batch upsert.
   *
   * Duplicate prevention is the unique constraint on
   * (user_id, source, source_item_id), not a pre-flight SELECT. Running the
   * same sync twice, or two syncs concurrently, therefore updates rows instead
   * of inserting a second copy -- and would still do so if this method had a
   * bug, which is the point of putting the guarantee in the schema.
   */
  async upsertMany(
    userId: string,
    courseId: string,
    records: readonly AssignmentSourceRecord[],
    syncedAt: Date,
  ): Promise<AssignmentUpsertResult> {
    if (records.length === 0) {
      return { rows: [], created: 0, updated: 0, unchanged: 0 };
    }

    const rows: AssignmentUpsertResult['rows'][number][] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const batch of chunk(records, UPSERT_BATCH_SIZE)) {
      const payload = batch.map((record) => toPayload(record));

      const { data, error } = await this.db.rpc('app_upsert_assignments', {
        p_user_id: userId,
        p_course_id: courseId,
        p_items: payload,
        p_synced_at: syncedAt.toISOString(),
      });

      if (error !== null) throw translatePostgrestError(error, 'assignments.upsertMany');

      for (const row of data ?? []) {
        rows.push({
          assignmentId: row.assignment_id,
          sourceItemId: row.source_item_id,
          created: row.created,
          changed: row.changed,
        });
        if (row.created) created += 1;
        else if (row.changed) updated += 1;
        else unchanged += 1;
      }
    }

    return { rows, created, updated, unchanged };
  }

  /**
   * Soft reconciliation of items absent from a listing.
   *
   * Refuses outright unless the listing was COMPLETE. The guard is here as well
   * as in the sync service because this is the only method in the codebase that
   * can move coursework out of a student's view, and one caller forgetting the
   * precondition must not be enough to lose data.
   */
  async reconcileMissing(
    userId: string,
    courseId: string,
    seenSourceItemIds: readonly string[],
    completeness: ListingCompleteness,
    at: Date,
  ): Promise<{ readonly markedMissing: number }> {
    if (completeness !== 'COMPLETE') {
      throw new PersistenceError(
        'Refusing to reconcile disappearances from an incomplete listing',
        { context: { courseId, completeness } },
      );
    }

    const { data, error } = await this.db.rpc('app_reconcile_missing_assignments', {
      p_user_id: userId,
      p_course_id: courseId,
      p_seen_item_ids: [...seenSourceItemIds],
      p_at: at.toISOString(),
      p_threshold: MISSING_STREAK_THRESHOLD,
    });

    if (error !== null) throw translatePostgrestError(error, 'assignments.reconcileMissing');
    return { markedMissing: data ?? 0 };
  }

  /**
   * The hot read path.
   *
   * One database function call resolves assignment, course, classification,
   * override and submission in a single query. Doing it in application code
   * would be four round trips and an N+1 over classifications; doing it in SQL
   * also guarantees every consumer applies override precedence identically.
   */
  async findUpcoming(query: UpcomingQuery): Promise<readonly UpcomingAssignment[]> {
    const { data, error } = await this.db.rpc('app_upcoming_assignments', {
      p_user_id: query.userId,
      p_to: query.to === null ? null : query.to.toISOString(),
      p_relevance: [...query.relevance],
      p_include_submitted: query.includeSubmitted,
      p_limit: query.limit,
    });

    if (error !== null) throw translatePostgrestError(error, 'assignments.findUpcoming');
    return (data ?? []).map(toUpcoming);
  }

  /**
   * Missed work. Same shape as upcoming, opposite side of the same boundary
   * function, ordered most-recently-missed first -- which is how a student
   * triages, rather than oldest-first.
   */
  async findOverdue(query: OverdueQuery): Promise<readonly UpcomingAssignment[]> {
    const { data, error } = await this.db.rpc('app_overdue_assignments', {
      p_user_id: query.userId,
      p_since: query.since === null ? null : query.since.toISOString(),
      p_relevance: [...query.relevance],
      p_include_submitted: query.includeSubmitted,
      p_limit: query.limit,
    });

    if (error !== null) throw translatePostgrestError(error, 'assignments.findOverdue');
    return (data ?? []).map(toUpcoming);
  }

  async findIgnored(userId: string, limit: number): Promise<readonly UpcomingAssignment[]> {
    const { data, error } = await this.db.rpc('app_ignored_assignments', {
      p_user_id: userId,
      p_limit: limit,
    });

    if (error !== null) throw translatePostgrestError(error, 'assignments.findIgnored');
    return (data ?? []).map(toUpcoming);
  }

  async setIgnored(
    userId: string,
    assignmentId: string,
    ignored: boolean,
    note: string | null,
  ): Promise<void> {
    const { error } = await this.db.rpc('app_set_assignment_ignored', {
      p_user_id: userId,
      p_assignment_id: assignmentId,
      p_ignored: ignored,
      p_note: note,
    });

    if (error !== null) throw translatePostgrestError(error, 'assignments.setIgnored');
  }

  /**
   * Tracked coursework with no due date.
   *
   * Its own function rather than a flag on findUpcoming: different filter,
   * different sort, different purpose. Keeping them apart is what stops undated
   * work from ever reaching a list the student reads as "what is due", while
   * still keeping it reachable.
   */
  async findUndated(query: UndatedQuery): Promise<readonly UndatedAssignment[]> {
    const { data, error } = await this.db.rpc('app_undated_assignments', {
      p_user_id: query.userId,
      p_relevance: [...query.relevance],
      p_limit: query.limit,
    });

    if (error !== null) throw translatePostgrestError(error, 'assignments.findUndated');

    return (data ?? []).map((row: UndatedAssignmentRow) => ({
      assignmentId: row.assignment_id,
      courseId: row.course_id,
      courseName: row.course_name,
      title: row.title,
      relevance: row.effective_relevance,
      hasManualOverride: row.has_manual_override,
      scopeType: row.scope_type,
      submissionState: row.submission_state,
      sourceCreatedAt: row.source_created_at === null ? null : new Date(row.source_created_at),
      alternateLink: row.alternate_link,
    }));
  }
}

function toPayload(record: AssignmentSourceRecord): AssignmentUpsertPayload {
  const { deadline } = record;

  return {
    source_item_id: record.sourceItemId,
    title: record.title,
    description: record.description,
    work_type: record.workType,
    source_state: record.sourceState,
    max_points: record.maxPoints,
    alternate_link: record.alternateLink,
    source_topic_id: record.sourceTopicId,
    assignee_mode: record.assigneeMode,
    individual_student_ids:
      record.individualStudentIds === null ? null : [...record.individualStudentIds],
    // The three deadline columns are written from the same value object, so the
    // CHECK constraint on due_precision cannot be violated by a partial write.
    due_date_raw: deadline.dueDate === null ? null : calendarDateToIso(deadline.dueDate),
    due_time_raw: deadline.dueTime === null ? null : clockTimeToIso(deadline.dueTime),
    due_at: toDbTimestamp(deadline.dueAt),
    due_precision: deadline.precision,
    source_created_at: toDbTimestamp(record.sourceCreatedAt),
    source_updated_at: toDbTimestamp(record.sourceUpdatedAt),
    source_fingerprint: fingerprintAssignment(record),
  };
}

function toUpcoming(row: UpcomingAssignmentRow): UpcomingAssignment {
  return {
    assignmentId: row.assignment_id,
    courseId: row.course_id,
    courseName: row.course_name,
    title: row.title,
    deadline: toDeadline(row),
    relevance: row.effective_relevance,
    confidence: Number(row.confidence),
    hasManualOverride: row.has_manual_override,
    scopeType: row.scope_type,
    scopeSections: row.scope_sections,
    submissionState: row.submission_state,
    lastSyncedAt: new Date(row.last_synced_at),
    alternateLink: row.alternate_link,
  };
}

/**
 * Rebuilds the deadline value object from its columns.
 *
 * `due_sort_at` is deliberately not read here. It exists for ORDER BY and
 * nothing else; surfacing it would let a caller mistake a sort key for a real
 * deadline on a DATE_ONLY item.
 */
function toDeadline(row: UpcomingAssignmentRow): Deadline {
  if (row.due_precision === 'NONE' || row.due_date_raw === null) {
    return { precision: 'NONE', dueDate: null, dueTime: null, dueAt: null };
  }

  const [year, month, day] = row.due_date_raw.split('-').map(Number);
  const dueDate = { year: year ?? 0, month: month ?? 0, day: day ?? 0 };

  if (row.due_precision === 'DATE_ONLY' || row.due_time_raw === null || row.due_at === null) {
    return { precision: 'DATE_ONLY', dueDate, dueTime: null, dueAt: null };
  }

  const [hours, minutes, seconds] = row.due_time_raw.split(':').map(Number);

  return {
    precision: 'EXACT',
    dueDate,
    dueTime: { hours: hours ?? 0, minutes: minutes ?? 0, seconds: seconds ?? 0 },
    dueAt: new Date(row.due_at),
  };
}
