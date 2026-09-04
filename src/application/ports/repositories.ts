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

export interface AcademicProfileInput {
  readonly primarySection: string;
  readonly programCode: string | null;
  readonly batch: string | null;
  readonly university: string | null;
  /** IANA zone. Decides where the day ends, so overdue depends on it. */
  readonly timeZone: string;
}

export interface AcademicProfileRepository {
  findByUserId(userId: string): Promise<AcademicProfileRecord | null>;

  /**
   * Creates or replaces the student's academic identity.
   *
   * Changing the section changes the alias set, which changes every
   * classification input fingerprint -- so the next sync re-evaluates
   * everything rather than leaving verdicts computed for the old section in
   * place. That is the intended behaviour, not a side effect to work around.
   */
  upsert(userId: string, input: AcademicProfileInput): Promise<AcademicProfileRecord>;

  /** Extra spellings the student adds by hand, beyond the generated ones. */
  replaceAliases(userId: string, aliases: readonly string[]): Promise<number>;
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
  /** Upper bound of the window. Null means "everything still ahead". */
  readonly to: Date | null;
  readonly relevance: readonly StudentRelevance[];
  readonly limit: number;
  readonly includeSubmitted: boolean;
}

export interface OverdueQuery {
  readonly userId: string;
  /**
   * Optional floor, so a student returning after a long break is not buried
   * under a year of missed work. Null means everything.
   */
  readonly since: Date | null;
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
   * Coursework whose deadline has passed and that is not submitted.
   *
   * Its own query rather than a widened window on findUpcoming: the two are
   * different lists, sorted differently, answering different questions. The
   * boundary between them lives in SQL (app_is_past_due) so they partition
   * exactly -- nothing appears in both, nothing falls between.
   */
  findOverdue(query: OverdueQuery): Promise<readonly UpcomingAssignment[]>;

  /**
   * Work the student has chosen to hide.
   *
   * A real list, not a void. Anything hideable must be findable again, or the
   * control is a delete button wearing a friendlier label.
   */
  findIgnored(userId: string, limit: number): Promise<readonly UpcomingAssignment[]>;

  /**
   * Hides or restores one assignment.
   *
   * Distinct from a classification override, and deliberately so. An override
   * says "this is not mine"; ignoring says "I know, stop showing me". Folding
   * the second into the first would record a missed lab that genuinely was for
   * the student's section as evidence that it was not.
   */
  setIgnored(
    userId: string,
    assignmentId: string,
    ignored: boolean,
    note: string | null,
    ): Promise<void>;

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
  /** Fencing token. Required by every write this worker makes. */
  readonly owner: string;
  readonly startedAt: Date;
  readonly mode: SyncMode;
  /** True when a previous invocation already enumerated the courses. */
  readonly discoveryCompleted: boolean;
  readonly resumeAttempts: number;
}

export interface SyncRunSummary {
  readonly syncRunId: string;
  readonly status: SyncRunStatus;
  readonly mode: SyncMode;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly counts: SyncCounts | null;
}

/**
 * Rate limiting for operations that reach Google.
 *
 * A port rather than an inline check so the limit can be faked in tests without
 * a database, and so a future Redis-backed implementation is a swap rather than
 * a rewrite.
 */
export interface RateLimiter {
  /**
   * Consumes one unit. Returns whether the caller may proceed, and how long to
   * wait if not -- so the API can answer with Retry-After instead of leaving a
   * client to guess.
   */
  consume(
    userId: string,
    bucket: string,
    limit: number,
    windowSeconds: number,
    ): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }>;
}

/**
 * The durable store behind a synchronisation run.
 *
 * Every method here exists so that no part of a sync depends on one process
 * staying alive. A worker claims a lease, pulls one unit at a time, records
 * each unit as it finishes, and either finalises or hands the run back. If it
 * dies at any point, everything it completed is already durable and the next
 * worker resumes from the queue rather than from the beginning.
 *
 * `owner` is a fencing token, and it is not decoration. A worker that was
 * declared dead can come back -- a paused instance, a socket that finally
 * returned -- and without the token it would happily overwrite the state of the
 * worker that replaced it. Every mutating method takes it, and the database
 * refuses the write when it no longer matches.
 */
export interface SyncRunRepository {
  /**
   * Starts a new run and claims it.
   *
   * Throws SyncAlreadyRunningError when the user already has a QUEUED or
   * RUNNING run. Reclaiming an expired lease happens inside the same
   * transaction, so two callers cannot both decide the old run is theirs.
   */
  start(
    userId: string,
    trigger: SyncTrigger,
    mode: SyncMode,
    leaseTtlSeconds: number,
    owner: string,
    ): Promise<SyncRunLease>;

  /**
   * Adopts an existing resumable run, or returns null if there is none.
   *
   * This is the method that makes the design independent of any single request.
   */
  resume(userId: string, leaseTtlSeconds: number, owner: string): Promise<SyncRunLease | null>;

  /** False when the lease has moved on; the caller must stop immediately. */
  renewLease(syncRunId: string, owner: string, leaseTtlSeconds: number): Promise<boolean>;

  /** Hands the run back as QUEUED so another invocation can continue it. */
  releaseLease(syncRunId: string, owner: string): Promise<boolean>;

  /** Idempotent: re-enqueueing cannot duplicate or reset a finished item. */
  enqueueCourses(
    syncRunId: string,
    owner: string,
    items: readonly SyncCourseQueueEntry[],
    ): Promise<number>;

  claimNextCourse(syncRunId: string, owner: string): Promise<SyncCourseWorkItem | null>;

  completeCourse(
    syncRunId: string,
    owner: string,
    result: CourseSyncResult,
    errorCode: string | null,
    ): Promise<boolean>;

  recordIssues(syncRunId: string, issues: readonly SyncIssue[]): Promise<void>;

  /**
   * Closes the run, returning the status the database derived from the queue.
   *
   * Null means it refused: either the lease moved on, or work is still pending.
   * The status is deliberately not an argument -- it is computed from the work
   * items, so no caller can report SUCCESS for a run that had a failed course.
   */
  finalize(
    syncRunId: string,
    owner: string,
    errorSummary: string | null,
    ): Promise<SyncRunStatus | null>;

  /** For faults no amount of resuming fixes: a revoked grant, a bad key. */
  failRun(syncRunId: string, owner: string, errorSummary: string): Promise<boolean>;

  progress(syncRunId: string, userId: string): Promise<SyncRunProgress | null>;

  latestForUser(userId: string): Promise<SyncRunSummary | null>;

  /**
   * When the data last became trustworthy *in full*.
   *
   * Only complete successes count. A PARTIAL run refreshed some courses and not
   * others, and treating it as the moment everything became current is how a
   * student is shown a course that failed to sync as though it were up to date.
   * Per-course recency is reported separately.
   */
  lastSuccessfulAt(userId: string): Promise<Date | null>;

  /** Users with a run that can be picked up. Drives the recovery sweep. */
  findResumableUserIds(limit: number): Promise<readonly string[]>;
}

export interface SyncCourseQueueEntry {
  readonly sourceCourseId: string;
  readonly courseId: string | null;
  readonly courseName: string | null;
}

export interface SyncCourseWorkItem extends SyncCourseQueueEntry {
  /** How many times this course has been claimed. Bounds pathological retries. */
  readonly attempts: number;
}

export interface SyncRunProgress {
  readonly syncRunId: string;
  readonly status: SyncRunStatus;
  readonly mode: SyncMode;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly counts: SyncCounts | null;
  readonly totalCourses: number;
  readonly completedCourses: number;
  readonly failedCourses: number;
  readonly errorSummary: string | null;
  readonly issueCodes: readonly string[];
}
