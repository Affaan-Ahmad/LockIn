import 'server-only';

import type {
  ClassificationRepository,
  ClassificationRow,
  OverrideRepository,
  SubmissionRepository,
} from '@/application/ports/repositories';
import type { SubmissionSourceRecord } from '@/domain/assignment/types';
import type { ManualOverride } from '@/domain/classification/relevance';
import { chunk } from '@/shared/concurrency';
import { NotFoundError } from '@/shared/errors';

import type { AppSupabaseClient } from '../clients';
import type {
  ClassificationUpsertPayload,
  SubmissionUpsertPayload,
} from '../database.types';
import { toDbTimestamp, translatePostgrestError } from './shared';

const UPSERT_BATCH_SIZE = 200;

export class SupabaseClassificationRepository implements ClassificationRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  /**
   * Existing input fingerprints, as a map.
   *
   * One query for the whole course. The alternative -- checking per assignment
   * before classifying it -- is the N+1 this signature exists to prevent.
   */
  async loadFingerprints(
    userId: string,
    assignmentIds: readonly string[],
    ): Promise<ReadonlyMap<string, string>> {
    if (assignmentIds.length === 0) return new Map();

    const out = new Map<string, string>();

    // Chunked because the id list becomes a URL query parameter, and a course
    // with a thousand items would otherwise exceed the request line limit.
    for (const batch of chunk(assignmentIds, 300)) {
      const { data, error } = await this.db
        .from('assignment_classifications')
        .select('assignment_id, input_fingerprint')
        .eq('user_id', userId)
        .in('assignment_id', batch);

      if (error !== null) {
        throw translatePostgrestError(error, 'classifications.loadFingerprints');
      }

      for (const row of data ?? []) out.set(row.assignment_id, row.input_fingerprint);
    }

    return out;
  }

  async upsertMany(userId: string, rows: readonly ClassificationRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    let written = 0;

    for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
      const payload: ClassificationUpsertPayload[] = batch.map((row) => ({
        assignment_id: row.assignmentId,
        relevance: row.relevance,
        confidence: row.confidence,
        decided_by_rule: row.decidedByRule,
        reason: row.reason,
        evidence: row.evidence,
        conflicted: row.conflicted,
        ruleset_version: row.rulesetVersion,
        input_fingerprint: row.inputFingerprint,
        scope_type: row.scopeType,
        scope_sections: [...row.scopeSections],
        scope_rule: row.scopeRule,
        scope_confidence: row.scopeConfidence,
      }));

      const { data, error } = await this.db.rpc('app_upsert_classifications', {
        p_user_id: userId,
        p_rows: payload,
      });

      if (error !== null) throw translatePostgrestError(error, 'classifications.upsertMany');
      written += data ?? 0;
    }

    return written;
  }

  /**
   * Cheap existence check: one row is enough to know a full pass is needed.
   *
   * Runs once per sync rather than per assignment, and the index on
   * (user_id, relevance) plus the tiny LIMIT keeps it to a single index probe.
   */
  async hasStaleRuleset(userId: string, currentVersion: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('assignment_classifications')
      .select('assignment_id')
      .eq('user_id', userId)
      .neq('ruleset_version', currentVersion)
      .limit(1);

    if (error !== null) throw translatePostgrestError(error, 'classifications.hasStaleRuleset');
    return (data ?? []).length > 0;
  }

  /**
   * Reads overrides. Note that there is no write method on this repository:
   * the sync pipeline gets read access to the student's decisions and nothing
   * more. Writing them is OverrideRepository's job, reached only from the
   * explicit user-action route.
   */
  async loadOverrides(
    userId: string,
    assignmentIds: readonly string[],
    ): Promise<ReadonlyMap<string, ManualOverride>> {
    if (assignmentIds.length === 0) return new Map();

    const out = new Map<string, ManualOverride>();

    for (const batch of chunk(assignmentIds, 300)) {
      const { data, error } = await this.db
        .from('classification_overrides')
        .select('assignment_id, relevance, note, updated_at')
        .eq('user_id', userId)
        .in('assignment_id', batch);

      if (error !== null) throw translatePostgrestError(error, 'classifications.loadOverrides');

      for (const row of data ?? []) {
        if (row.relevance === 'UNCERTAIN') continue;
        out.set(row.assignment_id, {
          relevance: row.relevance,
          note: row.note,
          decidedAt: new Date(row.updated_at),
        });
      }
    }

    return out;
  }
}

export class SupabaseOverrideRepository implements OverrideRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  async set(
    userId: string,
    assignmentId: string,
    relevance: 'RELEVANT' | 'NOT_RELEVANT',
    note: string | null,
    ): Promise<ManualOverride> {
    // Through the RPC rather than a direct upsert. PostgREST would let the
    // foreign key decide whether the assignment_id was acceptable, and a foreign
    // key is checked as the table owner -- so another user's assignment passed
    // while a non-existent one failed, which told the caller which was which.
    // app_set_override requires the assignment to be the caller's own and
    // answers P0002 either way. See 0014_override_ownership.sql.
    const { data, error } = await this.db.rpc('app_set_override', {
      p_user_id: userId,
      p_assignment_id: assignmentId,
      p_relevance: relevance,
      p_note: note,
    });

    if (error !== null) throw translatePostgrestError(error, 'overrides.set');

    // Normalised, not trusted. PostgREST is inconsistent about whether a
    // composite return arrives as an object or as a one-element array, and the
    // sync repository already carries the same guard for the same reason.
    // Reading `.updated_at` straight off `data` works right up until it does
    // not, and the failure would be a TypeError inside a write that had already
    // succeeded.
    const row = Array.isArray(data) ? data[0] : data;
    if (row === undefined || row === null || typeof row.id !== 'string') {
      throw new NotFoundError('Override was not persisted');
    }

    return {
      relevance: row.relevance === 'NOT_RELEVANT' ? 'NOT_RELEVANT' : 'RELEVANT',
      note: row.note,
      decidedAt: new Date(row.updated_at),
    };
  }

  async clear(userId: string, assignmentId: string): Promise<void> {
    const { error } = await this.db
      .from('classification_overrides')
      .delete()
      .eq('user_id', userId)
      .eq('assignment_id', assignmentId);

    if (error !== null) throw translatePostgrestError(error, 'overrides.clear');
  }

  async get(userId: string, assignmentId: string): Promise<ManualOverride | null> {
    const { data, error } = await this.db
      .from('classification_overrides')
      .select('relevance, note, updated_at')
      .eq('user_id', userId)
      .eq('assignment_id', assignmentId)
      .maybeSingle();

    if (error !== null) throw translatePostgrestError(error, 'overrides.get');
    if (data === null || data.relevance === 'UNCERTAIN') return null;

    return {
      relevance: data.relevance,
      note: data.note,
      decidedAt: new Date(data.updated_at),
    };
  }
}

export class SupabaseSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  async upsertMany(
    userId: string,
    courseId: string,
    records: readonly SubmissionSourceRecord[],
    syncedAt: Date,
    ): Promise<{ readonly upserted: number }> {
    if (records.length === 0) return { upserted: 0 };

    let upserted = 0;

    for (const batch of chunk(records, UPSERT_BATCH_SIZE)) {
      const payload: SubmissionUpsertPayload[] = batch.map((record) => ({
        source_submission_id: record.sourceSubmissionId,
        source_item_id: record.sourceItemId,
        state: record.state,
        late: record.late,
        alternate_link: record.alternateLink,
        source_created_at: toDbTimestamp(record.sourceCreatedAt),
        source_updated_at: toDbTimestamp(record.sourceUpdatedAt),
      }));

      const { data, error } = await this.db.rpc('app_upsert_submissions', {
        p_user_id: userId,
        p_course_id: courseId,
        p_items: payload,
        p_synced_at: syncedAt.toISOString(),
      });

      if (error !== null) throw translatePostgrestError(error, 'submissions.upsertMany');
      upserted += data ?? 0;
    }

    return { upserted };
  }
}
