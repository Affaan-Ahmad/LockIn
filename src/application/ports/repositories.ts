import type { AcademicIdentity, SectionAlias } from '@/domain/academic/types';
import type { Deadline } from '@/domain/assignment/deadline';
import type { LifecycleStatus, ListingCompleteness } from '@/domain/assignment/lifecycle';
import type {
  AcademicSourceId,
  AssignmentSourceRecord,
  CourseSourceRecord,
  SubmissionSourceRecord,
  TopicSourceRecord,
} from '@/domain/assignment/types';
import type { ManualOverride, StudentRelevance } from '@/domain/classification/relevance';
import type { AssignmentSectionScope } from '@/domain/classification/scope';
import type { DiscoveredCourse, TrackingDecision } from '@/domain/course/tracking';
import type {
  CourseSyncResult,
  SyncCounts,
  SyncIssue,
  SyncMode,
  SyncRunStatus,
  SyncTrigger,
} from '@/domain/sync/outcome';

/**
 * Repository ports.
 *
 * Shaped by the operations the application actually performs, not by tables.
 * There is no `findAll`, no `save(entity)`, no generic `Repository<T>` -- a
 * CRUD wrapper would add a layer without isolating anything, and would quietly
 * invite the N+1 patterns these signatures are designed to prevent. Every write
 * here is a batch, and every read states its filter.
 */

export interface AcademicProfileRecord {
  readonly userId: string;
  readonly identity: AcademicIdentity;
  readonly aliases: readonly SectionAlias[];
  /** IANA zone. Used for display only; stored deadlines stay in UTC. */
  readonly timeZone: string;
}

export interface AcademicProfileRepository {
  findByUserId(userId: string): Promise<AcademicProfileRecord | null>;
}

export interface StoredCourse {
  readonly id: string;
  readonly sourceCourseId: string;
  readonly name: string;
  readonly section: string | null;
  /** Newest source update timestamp already ingested for this course. */
  readonly courseworkWatermark: Date | null;
  readonly lifecycleStatus: LifecycleStatus;
}

export interface CourseRepository {
  upsertMany(
    userId: string,
    source: AcademicSourceId,
    records: readonly CourseSourceRecord[],
    syncedAt: Date,
  ): Promise<readonly StoredCourse[]>;

  listForUser(userId: string, source: AcademicSourceId): Promise<readonly StoredCourse[]>;

  setCourseworkWatermark(userId: string, courseId: string, watermark: Date | null): Promise<void>;

  upsertTopics(
    userId: string,
    courseId: string,
    topics: readonly TopicSourceRecord[],
    syncedAt: Date,
  ): Promise<void>;
}

/** Outcome of upserting one assignment, used for counting and for classification. */
export interface AssignmentUpsertRow {
  readonly assignmentId: string;
  readonly sourceItemId: string;
  readonly created: boolean;
  /** False when the source fingerprint was identical and nothing was written. */
  readonly changed: boolean;
}

export interface AssignmentUpsertResult {
  readonly rows: readonly AssignmentUpsertRow[];
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

/**
 * Course tracking, kept in its own port for the same reason it is kept in its
 * own table: sync reads it, and nothing in the sync path can write it.
 */
export interface CourseTrackingRepository {
  /** Every discovered course with the student's decision attached. */
  listDiscovered(userId: string): Promise<readonly DiscoveredCourse[]>;

  /** Course ids the student has opted into. The filter the sync pipeline uses. */
  listTrackedCourseIds(userId: string): Promise<ReadonlySet<string>>;

  /** Batch write; the only path that changes a tracking decision. */
  setTracking(
    userId: string,
    decisions: readonly { courseId: string; decision: TrackingDecision }[],
  ): Promise<number>;
}

export interface UndatedAssignment {
  readonly assignmentId: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly title: string;
  readonly relevance: StudentRelevance;
  readonly hasManualOverride: boolean;
  readonly scopeType: AssignmentSectionScope['type'];
  readonly submissionState: string | null;
  readonly sourceCreatedAt: Date | null;
  readonly alternateLink: string | null;
}

export interface UndatedQuery {
  readonly userId: string;
  readonly relevance: readonly StudentRelevance[];
  readonly limit: number;
}

export interface UpcomingAssignment {
  readonly assignmentId: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly title: string;
  readonly deadline: Deadline;
  readonly relevance: StudentRelevance;
  readonly confidence: number;
  readonly hasManualOverride: boolean;
  /** What the coursework targeted, kept distinct from what it means for me. */
  readonly scopeType: AssignmentSectionScope['type'];
  readonly scopeSections: readonly string[];
  readonly submissionState: string | null;
  readonly lastSyncedAt: Date;
  readonly alternateLink: string | null;
}

export interface UpcomingQuery {
  readonly userId: string;
  readonly from: Date;
  readonly to: Date | null;
  readonly relevance: readonly StudentRelevance[];
  readonly limit: number;
  readonly includeSubmitted: boolean;
}

export interface AssignmentRepository {
  /**
   * Batch upsert keyed on (userId, source, sourceItemId).
   *
   * Duplicate prevention is the database's job here, not the caller's: this
   * relies on the unique constraint, so a concurrent or repeated sync collides
   * rather than inserting a second row.
   */
  upsertMany(
    userId: string,
    courseId: string,
    records: readonly AssignmentSourceRecord[],
    syncedAt: Date,
  ): Promise<AssignmentUpsertResult>;

  /**
   * Reconciles items absent from a listing.
   *
   * Takes the completeness of the listing because a PARTIAL listing must be a
   * no-op; passing it in rather than letting the repository assume is what
   * stops an incremental sync from soft-deleting a whole course.
   */
  reconcileMissing(
    userId: string,
    courseId: string,
    seenSourceItemIds: readonly string[],
    completeness: ListingCompleteness,
    at: Date,
  ): Promise<{ readonly markedMissing: number }>;

  /**
   * The deadline feed.
   *
   * Tracked courses only, with a due date, ordered by when it is due. The
   * tracking and due-date filters are applied in SQL, not by the caller, so
   * every consumer sees the same feed.
   */
  findUpcoming(query: UpcomingQuery): Promise<readonly UpcomingAssignment[]>;

  /**
   * Tracked coursework Google gave no due date for.
   *
   * A separate query rather than a flag on the one above, because it is a
   * separate question with a different sort order and a different purpose. It
   * exists so that undated work is preserved and reachable without ever
   * polluting a list the student reads as "what is due".
   */
  findUndated(query: UndatedQuery): Promise<readonly UndatedAssignment[]>;
}

export interface SubmissionRepository {
  upsertMany(
    userId: string,
    courseId: string,
    records: readonly SubmissionSourceRecord[],
    syncedAt: Date,
  ): Promise<{ readonly upserted: number }>;
}

export interface ClassificationRow {
  readonly assignmentId: string;
  readonly relevance: StudentRelevance;
  readonly confidence: number;
  readonly decidedByRule: string | null;
  readonly reason: string;
  readonly evidence: unknown;
  readonly conflicted: boolean;
  readonly rulesetVersion: string;
  readonly inputFingerprint: string;
  /** The assignment's own scope, stored alongside but separate from relevance. */
  readonly scopeType: AssignmentSectionScope['type'];
  readonly scopeSections: readonly string[];
  readonly scopeRule: string;
  readonly scopeConfidence: number;
}

export interface ClassificationRepository {
  /**
   * Existing fingerprints for the given assignments.
   *
   * Lets the service skip rules for items whose content, aliases and ruleset
   * version are all unchanged. Returned as a map because the caller needs
   * per-item lookup and a list would force a scan per assignment.
   */
  loadFingerprints(
    userId: string,
    assignmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;

  upsertMany(userId: string, rows: readonly ClassificationRow[]): Promise<number>;

  /**
   * True when any stored verdict was produced by a different rule set version.
   *
   * An incremental sync only revisits coursework Google recently changed, so
   * without this a rule fix would silently leave every untouched assignment on
   * the old verdict. The sync service escalates to a full pass when this is
   * true, which is the only way the fix reaches those rows.
   */
  hasStaleRuleset(userId: string, currentVersion: string): Promise<boolean>;

  /**
   * Manual overrides, loaded separately from classifications because they have
   * a different owner and a different lifecycle. The sync path reads this and
   * never writes it.
   */
  loadOverrides(
    userId: string,
    assignmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ManualOverride>>;
}

export interface OverrideRepository {
  set(
    userId: string,
    assignmentId: string,
    relevance: 'RELEVANT' | 'NOT_RELEVANT',
    note: string | null,
  ): Promise<ManualOverride>;

  clear(userId: string, assignmentId: string): Promise<void>;

  get(userId: string, assignmentId: string): Promise<ManualOverride | null>;
}

export interface SyncRunLease {
  readonly syncRunId: string;
  readonly userId: string;
  readonly startedAt: Date;
  readonly mode: SyncMode;
}

export interface SyncRunSummary {
  readonly syncRunId: string;
  readonly status: SyncRunStatus;
  readonly mode: SyncMode;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly counts: SyncCounts | null;
}

export interface SyncRunRepository {
  /**
   * Claims the single active-run slot for this user.
   *
   * Throws SyncAlreadyRunningError when another run holds it. Reclaiming a
   * lease whose heartbeat has expired happens inside the same transaction as
   * the insert, so two callers cannot both reclaim and both insert.
   */
  acquire(
    userId: string,
    trigger: SyncTrigger,
    mode: SyncMode,
    leaseTtlSeconds: number,
  ): Promise<SyncRunLease>;

  heartbeat(syncRunId: string): Promise<void>;

  recordCourseResult(syncRunId: string, result: CourseSyncResult): Promise<void>;

  recordIssues(syncRunId: string, issues: readonly SyncIssue[]): Promise<void>;

  finalize(
    syncRunId: string,
    status: SyncRunStatus,
    counts: SyncCounts,
    finishedAt: Date,
  ): Promise<void>;

  latestForUser(userId: string): Promise<SyncRunSummary | null>;

  lastSuccessfulAt(userId: string): Promise<Date | null>;
}
