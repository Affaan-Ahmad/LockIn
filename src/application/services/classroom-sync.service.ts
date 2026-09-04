import type {
  AcademicProfileRepository,
  AssignmentRepository,
  ClassificationRepository,
  ClassificationRow,
  CourseRepository,
  CourseTrackingRepository,
  StoredCourse,
  SubmissionRepository,
  SyncCourseWorkItem,
  SyncRunLease,
  SyncRunRepository,
} from '@/application/ports/repositories';
import type { AcademicSourceAdapter } from '@/application/ports/source-adapter';
import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';
import type { StudentSectionProfile } from '@/domain/academic/types';
import type { AssignmentSourceRecord } from '@/domain/assignment/types';
import type {
  ManualOverride,
  RelevanceClassifier,
  RelevanceDecision,
  RelevanceInput,
} from '@/domain/classification/relevance';
import { ExecutionDeadline, type DeadlineOptions } from '@/domain/sync/deadline';
import type {
  CourseSyncResult,
  SyncCounts,
  SyncIssue,
  SyncMode,
  SyncRunStatus,
  SyncTrigger,
} from '@/domain/sync/outcome';
import { EMPTY_SYNC_COUNTS, addCounts } from '@/domain/sync/outcome';
import type { Clock } from '@/shared/clock';
import { AuthorizationExpiredError, ConfigError, toAppError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

import type { CourseDiscoveryService } from './course-discovery.service';

/**
 * A resumable synchronisation worker.
 *
 * The previous design ran an entire multi-course sync inside one HTTP request,
 * which meant the request staying alive *was* the reliability model. It is not
 * one: a serverless invocation is bounded, a sync is not, and being killed
 * mid-run left nothing finalised and nothing resumable.
 *
 * What replaces it:
 *
 *   THE DATABASE HOLDS THE PLAN. Discovery enqueues one work item per tracked
 *   course. That queue is the checkpoint -- no blob, no page cursor, no state in
 *   memory that dies with the process.
 *
 *   A WORKER TAKES ONE UNIT AT A TIME. It claims a course, syncs it, records
 *   the result, and only then looks at the next. Whatever it finished is
 *   durable the moment it finished.
 *
 *   IT STOPS BEFORE IT IS STOPPED. An internal deadline, well inside the
 *   platform's, decides whether there is time for another unit. When there is
 *   not, the worker hands the run back and asks for a successor. The platform
 *   timeout becomes the emergency boundary it should always have been.
 *
 *   EVERY WRITE IS FENCED. The lease carries an owner token. A worker that lost
 *   its lease -- because it stalled long enough to be declared dead -- cannot
 *   write anything, so it cannot corrupt the state of the worker that replaced
 *   it.
 *
 * The unit is one course, chosen from the shape of the Classroom API rather
 * than for convenience. A course's completeness verdict (COMPLETE vs PARTIAL)
 * is what licenses deletion reconciliation, and that verdict is only meaningful
 * for a whole course listing. Splitting finer would either forfeit
 * reconciliation or make it unsound, and unsound reconciliation deletes a
 * student's coursework.
 */

export interface ClassroomSyncServiceDeps {
  readonly source: AcademicSourceAdapter;
  readonly courses: CourseRepository;
  readonly assignments: AssignmentRepository;
  readonly submissions: SubmissionRepository;
  readonly classifications: ClassificationRepository;
  readonly tracking: CourseTrackingRepository;
  readonly discovery: CourseDiscoveryService;
  readonly profiles: AcademicProfileRepository;
  readonly syncRuns: SyncRunRepository;
  readonly classifier: RelevanceClassifier;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly config: SyncConfig;
  /** Injected so tests do not have to wait on real timers. */
  readonly scheduleHeartbeat?: (fn: () => void, intervalMs: number) => () => void;
}

export interface SyncConfig {
  readonly leaseTtlSeconds: number;
  /** Wall-clock this invocation may use before handing over. */
  readonly invocationBudgetMs: number;
  /** Held back from the budget for a clean checkout. */
  readonly checkoutReserveMs: number;
  /** Seed for "how long does one course take"; replaced by observation. */
  readonly initialUnitEstimateMs: number;
  /** A course claimed this many times without succeeding is given up on. */
  readonly maxCourseAttempts: number;
}

export interface StartSyncInput {
  readonly userId: string;
  readonly trigger: SyncTrigger;
  readonly mode: SyncMode;
  readonly googleUserId?: string | null;
  readonly onSourceUserIdObserved?: (sourceUserId: string) => Promise<void>;
}

/** Why this invocation stopped. The caller decides what to do about it. */
export type WorkOutcome =
  /** Every unit is done and the run has a terminal status. */
  | { readonly kind: 'COMPLETED'; readonly syncRunId: string; readonly status: SyncRunStatus }
  /** The deadline arrived with work left. The run is QUEUED for a successor. */
  | { readonly kind: 'HANDED_OFF'; readonly syncRunId: string; readonly remainingCourses: number }
  /** A run-level fault no retry can fix. The run is FAILED. */
  | { readonly kind: 'FAILED'; readonly syncRunId: string; readonly errorCode: string }
  /** The lease moved on mid-flight. Somebody else owns this run; do nothing. */
  | { readonly kind: 'FENCED'; readonly syncRunId: string };

export class ClassroomSyncService {
  constructor(private readonly deps: ClassroomSyncServiceDeps) {}

  /**
   * Claims a new run and returns immediately.
   *
   * Deliberately does no Google work. The caller answers the HTTP request with
   * this id and drives the actual synchronisation separately, so the student
   * gets an answer in milliseconds and the sync is not tied to their connection.
   */
  async start(input: StartSyncInput): Promise<SyncRunLease> {
    const mode = await this.resolveMode(input.userId, input.mode);

    return this.deps.syncRuns.start(
      input.userId,
      input.trigger,
      mode,
      this.deps.config.leaseTtlSeconds,
      newOwnerToken(),
    );
  }

  /** Adopts a run left QUEUED by a handover or a dead worker. */
  async resume(userId: string): Promise<SyncRunLease | null> {
    return this.deps.syncRuns.resume(
      userId,
      this.deps.config.leaseTtlSeconds,
      newOwnerToken(),
    );
  }

  /**
   * Processes units until the queue empties or the deadline arrives.
   *
   * Every exit path leaves the run in a state somebody else can act on: a
   * terminal status, or QUEUED with the completed work intact. There is no path
   * that leaves it RUNNING and owned by a worker that has gone away, except a
   * hard process kill -- which the lease expiry covers.
   */
  async work(lease: SyncRunLease, context: StartSyncInput): Promise<WorkOutcome> {
    const { deps } = this;
    const logger = deps.logger.child({
      syncRunId: lease.syncRunId,
      userId: lease.userId,
      mode: lease.mode,
      resumeAttempt: lease.resumeAttempts,
    });

    const deadline = new ExecutionDeadline(deps.clock, this.deadlineOptions());
    const stopHeartbeat = this.startHeartbeat(lease, logger);

    try {
      if (!lease.discoveryCompleted) {
        const planned = await this.plan(lease, logger);
        if (planned === 'FENCED') return { kind: 'FENCED', syncRunId: lease.syncRunId };
      }

      const student = await this.loadStudentProfile(lease, logger);

      for (;;) {
        const decision = deadline.shouldStartUnit();
        if (!decision.canStartAnotherUnit) {
          // Nothing is half-done here: the check happens between units, never
          // inside one.
          const released = await deps.syncRuns.releaseLease(lease.syncRunId, lease.owner);
          if (!released) return { kind: 'FENCED', syncRunId: lease.syncRunId };

          logger.info('handing sync over to a successor invocation', {
            stage: 'handover',
            reason: decision.reason,
            remainingMs: decision.remainingMs,
            unitsCompleted: deadline.completedUnits,
            unitEstimateMs: deadline.currentUnitEstimateMs,
          });
          return { kind: 'HANDED_OFF', syncRunId: lease.syncRunId, remainingCourses: -1 };
        }

        const item = await deps.syncRuns.claimNextCourse(lease.syncRunId, lease.owner);
        if (item === null) break;

        const startedAt = deps.clock.now().getTime();
        const fenced = await this.runUnit(lease, item, student, context, logger);
        if (fenced) return { kind: 'FENCED', syncRunId: lease.syncRunId };
        deadline.recordUnit(deps.clock.now().getTime() - startedAt);
      }

      const status = await deps.syncRuns.finalize(lease.syncRunId, lease.owner, null);
      if (status === null) {
        // Either the lease moved on or work reappeared. Both mean this worker
        // is no longer the authority on whether the run is finished.
        logger.warn('finalisation refused; another worker owns this run', { stage: 'finalize' });
        return { kind: 'FENCED', syncRunId: lease.syncRunId };
      }

      logger.info('sync run finished', {
        stage: 'finalize',
        status,
        unitsCompleted: deadline.completedUnits,
        durationMs: deadline.elapsedMs(),
      });
      return { kind: 'COMPLETED', syncRunId: lease.syncRunId, status };
    } catch (caught) {
      // Run-level faults only: a revoked grant, an unreadable credential, a
      // discovery call that could not complete. Course-level failures never
      // reach here -- they are recorded against their work item and the run
      // carries on, which is what makes one bad course survivable.
      const error = toAppError(caught);
      logger.error('sync run failed', {
        stage: 'run',
        errorCode: error.code,
        retryable: error.retryable,
      });

      await this.safely(
        () =>
          deps.syncRuns.recordIssues(lease.syncRunId, [
            {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              scope: 'RUN',
              sourceCourseId: null,
              sourceItemId: null,
            },
          ]),
        logger,
      );
      await this.safely(
        () => deps.syncRuns.failRun(lease.syncRunId, lease.owner, error.code),
        logger,
      );

      return { kind: 'FAILED', syncRunId: lease.syncRunId, errorCode: error.code };
    } finally {
      stopHeartbeat();
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * Discovery, then the work queue.
   *
   * Runs once per run, not once per invocation: `discovery_completed_at` is
   * stamped by the enqueue, so a continuation skips straight to the queue
   * rather than spending another Google call re-listing courses it already
   * enumerated.
   */
  private async plan(lease: SyncRunLease, logger: Logger): Promise<'PLANNED' | 'FENCED'> {
    const { deps } = this;
    const startedAt = deps.clock.now().getTime();

    const discovery = await deps.discovery.discover(lease.userId, lease.syncRunId);
    if (discovery.issues.length > 0) {
      await deps.syncRuns.recordIssues(lease.syncRunId, discovery.issues);
    }

    const allCourses = await deps.courses.listForUser(lease.userId, deps.source.id);
    const trackedIds = await deps.tracking.listTrackedCourseIds(lease.userId);
    const tracked = allCourses.filter((course) => trackedIds.has(course.id));

    const enqueued = await deps.syncRuns.enqueueCourses(
      lease.syncRunId,
      lease.owner,
      tracked.map((course) => ({
        sourceCourseId: course.sourceCourseId,
        courseId: course.id,
        courseName: course.name,
      })),
    );

    logger.info('sync plan built', {
      stage: 'discovery',
      discovered: discovery.courses.length,
      tracked: tracked.length,
      enqueued,
      completeness: discovery.completeness,
      durationMs: deps.clock.now().getTime() - startedAt,
    });

    if (tracked.length === 0 && discovery.courses.length > 0) {
      // Not a failure. The student has courses and has not chosen any, and
      // saying so plainly beats an empty successful sync.
      await deps.syncRuns.recordIssues(lease.syncRunId, [
        {
          code: 'NO_TRACKED_COURSES',
          message:
            'No courses are being tracked. Choose the subjects to follow before synchronising coursework.',
          retryable: false,
          scope: 'RUN',
          sourceCourseId: null,
          sourceItemId: null,
        },
      ]);
    }

    return 'PLANNED';
  }

  /**
   * One unit: sync a course, record what happened, never throw.
   *
   * A course failure is data, not an exception. Letting it propagate would end
   * the invocation and, worse, make the run's fate depend on which course
   * happened to be last. Returning `true` means the write was fenced, which is
   * the one case the caller must stop for.
   */
  private async runUnit(
    lease: SyncRunLease,
    item: SyncCourseWorkItem,
    student: StudentSectionProfile | null,
    context: StartSyncInput,
    parentLogger: Logger,
  ): Promise<boolean> {
    const { deps } = this;
    const logger = parentLogger.child({ sourceCourseId: item.sourceCourseId });
    const startedAt = deps.clock.now().getTime();

    let result: CourseSyncResult;
    let errorCode: string | null = null;

    try {
      const course = await this.loadCourse(lease.userId, item);
      result = await this.syncCourse(lease, course, student, context, logger);

      logger.info('course synchronised', {
        stage: 'course',
        completeness: result.completeness,
        attempt: item.attempts,
        durationMs: deps.clock.now().getTime() - startedAt,
        ...result.counts,
      });
    } catch (caught) {
      const error = toAppError(caught);

      // A dead credential is not this course's problem and will fail every
      // other course identically. Rethrowing turns it into the run-level
      // failure it actually is, instead of a queue of identical errors and a
      // dozen wasted Google calls.
      if (error instanceof AuthorizationExpiredError || error instanceof ConfigError) throw error;

      errorCode = error.code;
      result = {
        sourceCourseId: item.sourceCourseId,
        courseName: item.courseName ?? item.sourceCourseId,
        status: 'FAILED',
        completeness: 'FAILED',
        counts: { ...EMPTY_SYNC_COUNTS, coursesProcessed: 1, coursesFailed: 1 },
        issues: [
          {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            scope: 'COURSE',
            sourceCourseId: item.sourceCourseId,
            sourceItemId: null,
          },
        ],
      };

      logger.error('course synchronisation failed', {
        stage: 'course',
        errorCode: error.code,
        retryable: error.retryable,
        attempt: item.attempts,
        durationMs: deps.clock.now().getTime() - startedAt,
      });
    }

    if (result.issues.length > 0) {
      await this.safely(() => deps.syncRuns.recordIssues(lease.syncRunId, result.issues), logger);
    }

    const accepted = await deps.syncRuns.completeCourse(
      lease.syncRunId,
      lease.owner,
      result,
      errorCode,
    );
    return !accepted;
  }

  /**
   * The work item stores the course id, but the row is the source of truth for
   * the watermark -- which another run may have advanced since this one was
   * planned.
   */
  private async loadCourse(userId: string, item: SyncCourseWorkItem): Promise<StoredCourse> {
    const courses = await this.deps.courses.listForUser(userId, this.deps.source.id);
    const match = courses.find((course) => course.sourceCourseId === item.sourceCourseId);
    if (match === undefined) {
      throw new Error(`Course ${item.sourceCourseId} is no longer stored for this user`);
    }
    return match;
  }

  private async syncCourse(
    lease: SyncRunLease,
    course: StoredCourse,
    student: StudentSectionProfile | null,
    context: StartSyncInput,
    logger: Logger,
  ): Promise<CourseSyncResult> {
    const { deps } = this;
    const userId = lease.userId;

    let counts: SyncCounts = { ...EMPTY_SYNC_COUNTS, coursesProcessed: 1 };
    const issues: SyncIssue[] = [];

    const updatedSince = lease.mode === 'INCREMENTAL' ? course.courseworkWatermark : null;

    // Google is contacted here, with the whole response in memory before any
    // write begins. No database transaction is open across this call.
    const content = await deps.source.fetchCourseContent(
      { userId, syncRunId: lease.syncRunId },
      { sourceCourseId: course.sourceCourseId, name: course.name },
      { updatedSince },
    );

    issues.push(...content.issues);
    counts = addCounts(counts, { itemsRejectedByValidation: content.rejectedItemCount });

    if (content.observedSourceUserId !== null && context.onSourceUserIdObserved !== undefined) {
      await this.safely(
        () => context.onSourceUserIdObserved?.(content.observedSourceUserId as string),
        logger,
      );
    }

    const syncedAt = deps.clock.now();

    await deps.courses.upsertTopics(userId, course.id, content.topics, syncedAt);

    const upsert = await deps.assignments.upsertMany(
      userId,
      course.id,
      content.assignments,
      syncedAt,
    );

    counts = addCounts(counts, {
      assignmentsCreated: upsert.created,
      assignmentsUpdated: upsert.updated,
      assignmentsUnchanged: upsert.unchanged,
    });

    const submissionResult = await deps.submissions.upsertMany(
      userId,
      course.id,
      content.submissions,
      syncedAt,
    );
    counts = addCounts(counts, { submissionsUpserted: submissionResult.upserted });

    // Only a listing that enumerated the whole course may conclude that an
    // absent item was removed. An incremental prefix or a truncated page sweep
    // carries no information about absence at all.
    if (content.completeness === 'COMPLETE') {
      const seen = content.assignments.map((assignment) => assignment.sourceItemId);
      const reconciled = await deps.assignments.reconcileMissing(
        userId,
        course.id,
        seen,
        content.completeness,
        syncedAt,
      );
      counts = addCounts(counts, { assignmentsMarkedMissing: reconciled.markedMissing });
    }

    if (student !== null) {
      counts = addCounts(
        counts,
        await this.classifyCourse({
          userId,
          googleUserId: context.googleUserId ?? null,
          student,
          course,
          records: content.assignments,
          topicNames: new Map(content.topics.map((topic) => [topic.sourceTopicId, topic.name])),
          upsertedIds: new Map(upsert.rows.map((row) => [row.sourceItemId, row.assignmentId])),
          logger,
        }),
      );
    }

    // Advanced last, and only after every write above succeeded.
    //
    // This is what makes an interrupted course safe to redo. If the invocation
    // dies partway through, the watermark still points at the last fully
    // ingested state, so the retry re-reads the same window rather than
    // skipping past coursework it never persisted. Re-reading is cheap and
    // idempotent; skipping would lose an assignment silently.
    if (content.highWatermark !== null) {
      const next =
        course.courseworkWatermark === null || content.highWatermark > course.courseworkWatermark
          ? content.highWatermark
          : course.courseworkWatermark;
      await deps.courses.setCourseworkWatermark(userId, course.id, next);
    }

    counts = addCounts(counts, { coursesSucceeded: 1 });

    return {
      sourceCourseId: course.sourceCourseId,
      courseName: course.name,
      status: 'SUCCESS',
      completeness: content.completeness,
      counts,
      issues,
    };
  }

  /**
   * Classifies the coursework of one course.
   *
   * Everything needed is already in memory from the fetch, so this costs two
   * queries per course regardless of how many assignments it holds.
   */
  private async classifyCourse(args: {
    userId: string;
    googleUserId: string | null;
    student: StudentSectionProfile;
    course: StoredCourse;
    records: readonly AssignmentSourceRecord[];
    topicNames: ReadonlyMap<string, string>;
    upsertedIds: ReadonlyMap<string, string>;
    logger: Logger;
  }): Promise<Partial<SyncCounts>> {
    const { deps } = this;
    const assignmentIds = [...args.upsertedIds.values()];
    if (assignmentIds.length === 0) return {};

    const [existingFingerprints, overrides] = await Promise.all([
      deps.classifications.loadFingerprints(args.userId, assignmentIds),
      deps.classifications.loadOverrides(args.userId, assignmentIds),
    ]);

    const rows: ClassificationRow[] = [];
    let relevant = 0;
    let notRelevant = 0;
    let uncertain = 0;

    for (const record of args.records) {
      const assignmentId = args.upsertedIds.get(record.sourceItemId);
      if (assignmentId === undefined) continue;

      const override: ManualOverride | null = overrides.get(assignmentId) ?? null;

      const classificationInput: RelevanceInput = {
        student: args.student,
        googleUserId: args.googleUserId,
        override,
        item: {
          source: record.source,
          sourceItemId: record.sourceItemId,
          title: record.title,
          description: record.description,
          topicName:
            record.sourceTopicId === null
              ? null
              : (args.topicNames.get(record.sourceTopicId) ?? null),
          assigneeMode: record.assigneeMode,
          individualStudentIds: record.individualStudentIds,
          courseSectionLabel: args.course.section,
        },
      };

      // Skip only when every input is provably identical, including the ruleset
      // version and the student's alias set.
      const fingerprint = deps.classifier.fingerprintOf(classificationInput);
      if (existingFingerprints.get(assignmentId) === fingerprint) continue;

      const decision = deps.classifier.classify(classificationInput);

      if (decision.relevance === 'RELEVANT') relevant += 1;
      else if (decision.relevance === 'NOT_RELEVANT') notRelevant += 1;
      else uncertain += 1;

      rows.push({
        assignmentId,
        relevance: decision.relevance,
        confidence: decision.confidence,
        decidedByRule: decision.decidedBy,
        reason: decision.reason,
        evidence: decision.evidence,
        conflicted: decision.scopeRule === 'SCOPE_CONFLICT',
        rulesetVersion: decision.rulesetVersion,
        inputFingerprint: fingerprint,
        scopeType: decision.scope.type,
        scopeSections: sectionsOf(decision.scope),
        scopeRule: decision.scopeRule,
        scopeConfidence: decision.scopeConfidence,
      });
    }

    if (rows.length === 0) return {};

    const written = await deps.classifications.upsertMany(args.userId, rows);

    args.logger.debug('classified coursework', {
      stage: 'classification',
      evaluated: rows.length,
      written,
      relevant,
      notRelevant,
      uncertain,
    });

    return {
      classificationsWritten: written,
      relevantCount: relevant,
      notRelevantCount: notRelevant,
      uncertainCount: uncertain,
    };
  }

  /**
   * Decides whether an incremental pass is safe.
   *
   * An incremental sync only revisits coursework Google changed recently. If the
   * rule set has moved on since those verdicts were written, items Google did
   * not touch would keep their old classification forever.
   */
  private async resolveMode(userId: string, requested: SyncMode): Promise<SyncMode> {
    if (requested === 'FULL') return 'FULL';

    const stale = await this.deps.classifications.hasStaleRuleset(
      userId,
      this.deps.classifier.version,
    );
    if (!stale) return 'INCREMENTAL';

    this.deps.logger.info('escalating to a full sync: stored verdicts predate the rule set', {
      userId,
      rulesetVersion: this.deps.classifier.version,
    });
    return 'FULL';
  }

  /**
   * A missing academic profile does not abort the run.
   *
   * Source data is still worth ingesting. What we will not do is classify
   * without knowing the student's section, because every verdict would be an
   * invention. Unclassified assignments read back as UNCERTAIN, which is honest.
   */
  private async loadStudentProfile(
    lease: SyncRunLease,
    logger: Logger,
  ): Promise<StudentSectionProfile | null> {
    const profile = await this.deps.profiles.findByUserId(lease.userId);
    if (profile === null) {
      logger.warn('no academic profile; coursework will be synced but not classified', {
        stage: 'profile',
      });
      await this.safely(
        () =>
          this.deps.syncRuns.recordIssues(lease.syncRunId, [
            {
              code: 'NO_ACADEMIC_PROFILE',
              message:
                'No academic profile is configured, so relevance was not evaluated. Coursework was still synchronised.',
              retryable: false,
              scope: 'RUN',
              sourceCourseId: null,
              sourceItemId: null,
            },
          ]),
        logger,
      );
      return null;
    }

    return buildStudentSectionProfile(profile.identity, profile.aliases);
  }

  /**
   * Keeps the lease alive while this worker is genuinely working.
   *
   * Renewal is fenced: once the token stops matching, renewal fails and stays
   * failed. That is the signal that this worker has been replaced -- there is
   * nothing useful it can do afterwards, and every write it attempts will be
   * refused, so it only needs to stop.
   */
  private startHeartbeat(lease: SyncRunLease, logger: Logger): () => void {
    // A third of the TTL: two consecutive misses still leave a renewal before
    // the lease lapses.
    const intervalMs = Math.max(5_000, (this.deps.config.leaseTtlSeconds * 1000) / 3);

    const schedule =
      this.deps.scheduleHeartbeat ??
      ((fn: () => void, ms: number): (() => void) => {
        const timer = setInterval(fn, ms);
        timer.unref?.();
        return () => clearInterval(timer);
      });

    return schedule(() => {
      void this.deps.syncRuns
        .renewLease(lease.syncRunId, lease.owner, this.deps.config.leaseTtlSeconds)
        .then((renewed) => {
          if (!renewed) {
            logger.warn('lease is no longer ours; another worker owns this run', {
              stage: 'heartbeat',
            });
          }
        })
        .catch((cause: unknown) => {
          logger.warn('lease renewal failed', {
            stage: 'heartbeat',
            errorCode: toAppError(cause).code,
          });
        });
    }, intervalMs);
  }

  private deadlineOptions(): DeadlineOptions {
    return {
      budgetMs: this.deps.config.invocationBudgetMs,
      reserveMs: this.deps.config.checkoutReserveMs,
      initialUnitEstimateMs: this.deps.config.initialUnitEstimateMs,
    };
  }

  /** Best-effort bookkeeping must never mask the real failure. */
  private async safely(fn: () => Promise<unknown> | undefined, logger: Logger): Promise<void> {
    try {
      await fn();
    } catch (cause) {
      logger.warn('non-critical operation failed', { errorCode: toAppError(cause).code });
    }
  }
}

/**
 * The sections a scope names: targeted for SPECIFIC_SECTIONS, excluded for
 * ALL_SECTIONS_EXCEPT. The column is interpreted through scope_type.
 */
function sectionsOf(scope: RelevanceDecision['scope']): string[] {
  if (scope.type === 'SPECIFIC_SECTIONS') return [...scope.sections];
  if (scope.type === 'ALL_SECTIONS_EXCEPT') return [...scope.excluded];
  return [];
}

/**
 * A fresh fencing token per claim.
 *
 * Never derived from the run id or the user: the whole point is that a worker
 * which claimed the same run five minutes ago holds a *different* token, so its
 * writes are rejected once the run has moved on.
 */
function newOwnerToken(): string {
  return crypto.randomUUID();
}
