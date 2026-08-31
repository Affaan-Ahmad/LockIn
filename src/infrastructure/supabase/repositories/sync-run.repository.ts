import 'server-only';

import type {
  AcademicProfileInput,
  AcademicProfileRepository,
  AcademicProfileRecord,
  SyncRunLease,
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
import type { SyncRunRow } from '../database.types';
import { translatePostgrestError } from './shared';

export class SupabaseSyncRunRepository implements SyncRunRepository {
  constructor(
    private readonly db: AppSupabaseClient,
    private readonly leaseTtlSeconds: number,
  ) {}

  /**
   * Claims the single active-run slot.
   *
   * The real guarantee is the partial unique index in the schema; the RPC adds
   * stale-lease reclamation inside the same transaction, under an advisory lock,
   * so a crashed run does not block the account forever and two racing callers
   * cannot both decide the old lease is theirs to take.
   */
  async acquire(
    userId: string,
    trigger: SyncTrigger,
    mode: SyncMode,
    leaseTtlSeconds: number,
  ): Promise<SyncRunLease> {
    const { data, error } = await this.db.rpc('app_acquire_sync_run', {
      p_user_id: userId,
      p_trigger: trigger,
      p_mode: mode,
      p_lease_ttl_seconds: leaseTtlSeconds,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.acquire');

    const row = firstRow(data);
    if (row === null) throw new PersistenceError('Sync run lease was not returned');

    return {
      syncRunId: row.id,
      userId: row.user_id,
      startedAt: new Date(row.started_at),
      mode: row.mode,
    };
  }

  async heartbeat(syncRunId: string): Promise<void> {
    const { error } = await this.db.rpc('app_heartbeat_sync_run', {
      p_sync_run_id: syncRunId,
      p_lease_ttl_seconds: this.leaseTtlSeconds,
    });
    if (error !== null) throw translatePostgrestError(error, 'syncRuns.heartbeat');
  }

  async recordCourseResult(syncRunId: string, result: CourseSyncResult): Promise<void> {
    const { error } = await this.db.from('sync_course_results').upsert(
      {
        sync_run_id: syncRunId,
        source_course_id: result.sourceCourseId,
        course_name: result.courseName,
        status: result.status,
        completeness: result.completeness,
        counts: result.counts as unknown as Record<string, number>,
        user_id: await this.resolveUserId(syncRunId),
      },
      { onConflict: 'sync_run_id,source_course_id' },
    );

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.recordCourseResult');
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
    status: SyncRunStatus,
    counts: SyncCounts,
    _finishedAt: Date,
  ): Promise<void> {
    if (status === 'RUNNING') {
      throw new PersistenceError('A sync run cannot be finalised to RUNNING');
    }

    const { error } = await this.db.rpc('app_finalize_sync_run', {
      p_sync_run_id: syncRunId,
      p_status: status,
      p_counts: counts as unknown as Record<string, number>,
      p_error_summary: null,
    });

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.finalize');
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
   * When the data last became trustworthy.
   *
   * PARTIAL_SUCCESS counts, because a partial run genuinely did refresh the
   * courses it reached. The freshness model separately downgrades a partial run
   * so the distinction is never lost -- it just is not lost *here*, by pretending
   * the sync never happened.
   */
  async lastSuccessfulAt(userId: string): Promise<Date | null> {
    const { data, error } = await this.db
      .from('sync_runs')
      .select('finished_at')
      .eq('user_id', userId)
      .in('status', ['SUCCESS', 'PARTIAL_SUCCESS'])
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'syncRuns.lastSuccessfulAt');
    const finishedAt = data?.finished_at ?? null;
    if (finishedAt === null) return null;
    return new Date(finishedAt);
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

function firstRow(data: SyncRunRow[] | SyncRunRow | null): SyncRunRow | null {
  if (data === null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}
