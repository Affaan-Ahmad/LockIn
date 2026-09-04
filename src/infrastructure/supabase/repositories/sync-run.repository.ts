import 'server-only';

import type {
  AcademicProfileInput,
  AcademicProfileRepository,
  AcademicProfileRecord,
  SyncCourseQueueEntry,
  SyncCourseWorkItem,
  SyncRunLease,
  SyncRunProgress,
  SyncRunRepository,
  SyncRunSummary,
} from '@/application/ports/repositories';
import type { SectionAlias } from '@/domain/academic/types';
import type {
  CourseSyncResult,
  SyncCounts,
  SyncIssue,
  SyncMode,
  SyncRunStatus,
  SyncTrigger,
} from '@/domain/sync/outcome';
import { PersistenceError } from '@/shared/errors';

import type { AppSupabaseClient } from '../clients';
import type { SyncCourseResultRow, SyncRunRow } from '../database.types';
import { translatePostgrestError } from './shared';

export class SupabaseSyncRunRepository implements SyncRunRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  async start(
    userId: string,
    trigger: SyncTrigger,
    mode: SyncMode,
    leaseTtlSeconds: number,
    owner: string,
    ): Promise<SyncRunLease> {
    const { data, error } = await this.db.rpc('app_start_sync_run', {
      p_user_id: userId,
      p_trigger: trigger,
      p_mode: mode,
      p_lease_ttl_seconds: leaseTtlSeconds,
      p_owner: owner,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.start');

    const row = firstRow(data);
    if (row === null) throw new PersistenceError('Sync run lease was not returned');

    return toLease(row, owner);
  }

  async resume(
    userId: string,
    leaseTtlSeconds: number,
    owner: string,
    ): Promise<SyncRunLease | null> {
    const { data, error } = await this.db.rpc('app_resume_sync_run', {
      p_user_id: userId,
      p_lease_ttl_seconds: leaseTtlSeconds,
      p_owner: owner,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.resume');

    const row = firstRow(data);
    // Not an error. "Nothing to resume" is the ordinary answer whenever a sweep
    // or a duplicate continuation arrives after the work is already done.
    return row === null ? null : toLease(row, owner);
  }

  async renewLease(
    syncRunId: string,
    owner: string,
    leaseTtlSeconds: number,
    ): Promise<boolean> {
    const { data, error } = await this.db.rpc('app_renew_sync_lease', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
      p_lease_ttl_seconds: leaseTtlSeconds,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.renewLease');
    return data === true;
  }

  async releaseLease(syncRunId: string, owner: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('app_release_sync_lease', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.releaseLease');
    return data === true;
  }

  async enqueueCourses(
    syncRunId: string,
    owner: string,
    items: readonly SyncCourseQueueEntry[],
    ): Promise<number> {
    const { data, error } = await this.db.rpc('app_enqueue_sync_courses', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
      p_courses: items.map((item) => ({
        source_course_id: item.sourceCourseId,
        course_id: item.courseId,
        course_name: item.courseName,
      })),
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.enqueueCourses');
    return data ?? 0;
  }

  async claimNextCourse(
    syncRunId: string,
    owner: string,
    ): Promise<SyncCourseWorkItem | null> {
    const { data, error } = await this.db.rpc('app_claim_next_sync_course', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.claimNextCourse');

    const row = firstCourseRow(data);
    if (row === null) return null;

    return {
      sourceCourseId: row.source_course_id,
      courseId: row.course_id,
      courseName: row.course_name,
      attempts: row.attempts,
    };
  }

  async completeCourse(
    syncRunId: string,
    owner: string,
    result: CourseSyncResult,
    errorCode: string | null,
    ): Promise<boolean> {
    const { data, error } = await this.db.rpc('app_complete_sync_course', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
      p_source_course_id: result.sourceCourseId,
      p_status: result.status,
      p_completeness: result.completeness,
      p_counts: result.counts as unknown as Record<string, number>,
      p_error_code: errorCode,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.completeCourse');
    return data === true;
  }

  async recordIssues(syncRunId: string, issues: readonly SyncIssue[]): Promise<void> {
    if (issues.length === 0) return;

    const userId = await this.resolveUserId(syncRunId);

    const { error } = await this.db.from('sync_errors').insert(
      issues.map((issue) => ({
        sync_run_id: syncRunId,
        user_id: userId,
        scope: issue.scope,
        code: issue.code,
        message: issue.message,
        retryable: issue.retryable,
        source_course_id: issue.sourceCourseId,
        source_item_id: issue.sourceItemId,
        context: {},
      })),
    );

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.recordIssues');
  }

  async finalize(
    syncRunId: string,
    owner: string,
    errorSummary: string | null,
    ): Promise<SyncRunStatus | null> {
    const { data, error } = await this.db.rpc('app_finalize_sync_run', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
      p_error_summary: errorSummary,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.finalize');
    // Null means the database refused: the lease moved on, or work remains.
    // Either way this worker must not claim the run is finished.
    return data ?? null;
  }

  async failRun(syncRunId: string, owner: string, errorSummary: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('app_fail_sync_run', {
      p_sync_run_id: syncRunId,
      p_owner: owner,
      p_error_summary: errorSummary,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.failRun');
    return data === true;
  }

  async progress(syncRunId: string, userId: string): Promise<SyncRunProgress | null> {
    const { data, error } = await this.db
      .from('sync_runs')
      .select('id, status, mode, started_at, finished_at, counts, error_summary')
      .eq('id', syncRunId)
      // Explicit even though RLS also scopes this. A progress endpoint that
      // leaked another account's run would leak course counts and timing.
      .eq('user_id', userId)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.progress');
    if (data === null) return null;

    const [courses, issues] = await Promise.all([
      this.db.from('sync_course_results').select('status').eq('sync_run_id', syncRunId),
      this.db.from('sync_errors').select('code').eq('sync_run_id', syncRunId).limit(20),
    ]);

    if (courses.error !== null) {
      throw translatePostgrestError(courses.error, 'syncRuns.progressCourses');
    }
    if (issues.error !== null) {
      throw translatePostgrestError(issues.error, 'syncRuns.progressIssues');
    }

    const rows = courses.data ?? [];

    return {
      syncRunId: data.id,
      status: data.status,
      mode: data.mode,
      startedAt: new Date(data.started_at),
      finishedAt: data.finished_at === null ? null : new Date(data.finished_at),
      counts: (data.counts as unknown as SyncCounts | null) ?? null,
      totalCourses: rows.length,
      completedCourses: rows.filter((row) => row.status === 'SUCCESS').length,
      failedCourses: rows.filter((row) => row.status === 'FAILED').length,
      errorSummary: data.error_summary,
      issueCodes: [...new Set((issues.data ?? []).map((row) => row.code))],
    };
  }

  async latestForUser(userId: string): Promise<SyncRunSummary | null> {
    const { data, error } = await this.db
      .from('sync_runs')
      .select('id, status, mode, started_at, finished_at, counts')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.latestForUser');
    if (data === null) return null;

    return {
      syncRunId: data.id,
      status: data.status,
      mode: data.mode,
      startedAt: new Date(data.started_at),
      finishedAt: data.finished_at === null ? null : new Date(data.finished_at),
      counts: (data.counts as unknown as SyncCounts | null) ?? null,
    };
  }

  /**
   * When the data last became trustworthy in full.
   *
   * PARTIAL_SUCCESS is deliberately excluded, which changes the old behaviour.
   * A partial run genuinely refreshed the courses it reached -- but treating it
   * as the moment *everything* became current is precisely how a student is
   * shown a course that failed to sync as though it were up to date. Per-course
   * recency now carries that information, and carries it honestly.
   */
  async lastSuccessfulAt(userId: string): Promise<Date | null> {
    const { data, error } = await this.db
      .from('sync_runs')
      .select('finished_at')
      .eq('user_id', userId)
      .eq('status', 'SUCCESS')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.lastSuccessfulAt');
    const finishedAt = data?.finished_at ?? null;
    if (finishedAt === null) return null;
    return new Date(finishedAt);
  }

  /**
   * Users whose run can be picked up.
   *
   * Service-role in practice: the recovery sweep runs across accounts, so it
   * cannot be scoped to a session. Returns ids and nothing else.
   */
  async findResumableUserIds(limit: number): Promise<readonly string[]> {
    const { data, error } = await this.db
      .from('sync_runs')
      .select('user_id, status, lease_expires_at')
      .in('status', ['QUEUED', 'RUNNING'])
      .lt('lease_expires_at', new Date().toISOString())
      .order('lease_expires_at', { ascending: true })
      .limit(limit);

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.findResumable');
    return [...new Set((data ?? []).map((row) => row.user_id))];
  }

  private async resolveUserId(syncRunId: string): Promise<string> {
    const cached = this.userIdCache.get(syncRunId);
    if (cached !== undefined) return cached;

    const { data, error } = await this.db
      .from('sync_runs')
      .select('user_id')
      .eq('id', syncRunId)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.resolveUserId');
    if (data === null) throw new PersistenceError('Sync run not found', { context: { syncRunId } });

    this.userIdCache.set(syncRunId, data.user_id);
    return data.user_id;
  }

  /** A run's owner cannot change, so one lookup per run is enough. */
  private readonly userIdCache = new Map<string, string>();
}

function toLease(row: SyncRunRow, owner: string): SyncRunLease {
  return {
    syncRunId: row.id,
    userId: row.user_id,
    owner,
    startedAt: new Date(row.started_at),
    mode: row.mode,
    discoveryCompleted: row.discovery_completed_at !== null,
    resumeAttempts: row.resume_attempts,
  };
}

export class SupabaseAcademicProfileRepository implements AcademicProfileRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  /**
   * Profile and aliases in two queries rather than a join, because the alias
   * list is a separate collection and embedding it would return the profile
   * columns repeated once per alias.
   */
  async findByUserId(userId: string): Promise<AcademicProfileRecord | null> {
    const { data: profile, error: profileError } = await this.db
      .from('academic_profiles')
      .select('user_id, university, program_code, batch, primary_section, time_zone')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError !== null) {
      throw translatePostgrestError(profileError, 'academicProfiles.findByUserId');
    }
    if (profile === null) return null;

    const { data: aliasRows, error: aliasError } = await this.db
      .from('section_aliases')
      .select('alias_raw, alias_key, kind, source')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (aliasError !== null) {
      throw translatePostgrestError(aliasError, 'academicProfiles.loadAliases');
    }

    const aliases: SectionAlias[] = (aliasRows ?? []).map((row) => ({
      raw: row.alias_raw,
      key: row.alias_key,
      kind: row.kind,
      source: row.source,
    }));

    return {
      userId: profile.user_id,
      identity: {
        primarySection: profile.primary_section,
        programCode: profile.program_code,
        batch: profile.batch,
      },
      aliases,
      timeZone: profile.time_zone,
    };
  }

  /**
   * Writes the student's academic identity.
   *
   * Derived aliases are not stored: they are regenerated from this row on every
   * classification run. Persisting them would create a second copy that goes
   * stale the moment the alias generator changes, and the generator is an
   * explicit extension point.
   */
  async upsert(userId: string, input: AcademicProfileInput): Promise<AcademicProfileRecord> {
    const { data, error } = await this.db
      .from('academic_profiles')
      .upsert(
        {
          user_id: userId,
          primary_section: input.primarySection.trim(),
          program_code: input.programCode,
          batch: input.batch,
          university: input.university,
          time_zone: input.timeZone,
        },
        { onConflict: 'user_id' },
      )
      .select('user_id, university, program_code, batch, primary_section, time_zone')
      .single();

    if (error !== null) throw translatePostgrestError(error, 'academicProfiles.upsert');
    if (data === null) throw new PersistenceError('Academic profile was not persisted');

    const existing = await this.findByUserId(userId);

    return {
      userId: data.user_id,
      identity: {
        primarySection: data.primary_section,
        programCode: data.program_code,
        batch: data.batch,
      },
      aliases: existing?.aliases ?? [],
      timeZone: data.time_zone,
    };
  }

  /**
   * Replaces the hand-added aliases.
   *
   * Delete-then-insert rather than a diff: the set is a handful of rows, and a
   * diff would be more code for no benefit. Only USER-sourced rows are touched,
   * so a future stored derived alias could not be destroyed by this.
   */
  async replaceAliases(userId: string, aliases: readonly string[]): Promise<number> {
    const cleaned = [...new Set(aliases.map((a) => a.trim()).filter((a) => a !== ''))];

    const { error: deleteError } = await this.db
      .from('section_aliases')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'USER');

    if (deleteError !== null) {
      throw translatePostgrestError(deleteError, 'academicProfiles.clearAliases');
    }

    if (cleaned.length === 0) return 0;

    const { error } = await this.db.from('section_aliases').insert(
      cleaned.map((alias) => ({
        user_id: userId,
        alias_raw: alias,
        // alias_key is derived by a database trigger, so the normalisation the
        // classifier relies on cannot drift from what is stored here.
        alias_key: '',
        kind: 'CUSTOM' as const,
        source: 'USER' as const,
        is_active: true,
      })),
    );

    if (error !== null) throw translatePostgrestError(error, 'academicProfiles.setAliases');
    return cleaned.length;
  }
}

/**
 * A `returns sync_runs` function answers with a row, which PostgREST renders as
 * either a single object or a one-element array depending on the call. Both are
 * handled rather than depending on which one today's client library picks.
 */
function firstRow(data: SyncRunRow[] | SyncRunRow | null): SyncRunRow | null {
  if (data === null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function firstCourseRow(
  data: SyncCourseResultRow[] | SyncCourseResultRow | null,
): SyncCourseResultRow | null {
  if (data === null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  // A plpgsql function returning a composite type yields a row of all-null
  // columns rather than SQL NULL when it returns early. That is "no work left",
  // not a work item whose id happens to be null.
  return data.id === null ? null : data;
}
