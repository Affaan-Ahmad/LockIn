import type {
  AcademicProfileRepository,
  AssignmentRepository,
  ClassificationRepository,
  ClassificationRow,
  CourseRepository,
  CourseTrackingRepository,
  StoredCourse,
  SubmissionRepository,
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
import type { CourseDiscoveryService } from './course-discovery.service';
import type {
  CourseSyncResult,
  SyncCounts,
  SyncIssue,
  SyncMode,
  SyncRunOutcome,
  SyncTrigger,
} from '@/domain/sync/outcome';
import { EMPTY_SYNC_COUNTS, addCounts, resolveRunStatus } from '@/domain/sync/outcome';
import type { Clock } from '@/shared/clock';
import { mapWithConcurrency } from '@/shared/concurrency';
import { toAppError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

/**
 * Orchestrates one synchronisation run.
 *
 * Every step it performs lives somewhere else: fetching is the adapter's,
 * persistence is the repositories', deciding relevance is the engine's. What
 * remains here is sequencing, concurrency, counting and failure containment --
 * which is why this file is a few hundred lines instead of the thousand-line
 * `syncEverything()` this design exists to avoid.
 *
 * Three properties are load-bearing:
 *
 *   PARTIAL SUCCESS IS A REAL OUTCOME. One course failing does not discard the
 *   others. Each course's result is recorded independently and the run reports
 *   what actually happened.
 *
 *   NO NETWORK CALL HOLDS A TRANSACTION. Google is contacted, the response is
 *   fully in memory, and only then does a short transactional batch write run.
 *
 *   DELETION REQUIRES PROOF. Disappearance reconciliation runs only for a
 *   course whose listing came back COMPLETE.
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
  readonly courseConcurrency: number;
  readonly leaseTtlSeconds: number;
}

export interface RunSyncInput {
  readonly userId: string;
  readonly trigger: SyncTrigger;
  readonly mode: SyncMode;
  /** Learned from Classroom submissions; persisted by the caller. */
  readonly onSourceUserIdObserved?: (sourceUserId: string) => Promise<void>;
  /** Known Classroom user id, enabling the source-targeting rule. */
  readonly googleUserId?: string | null;
}

export class ClassroomSyncService {
  constructor(private readonly deps: ClassroomSyncServiceDeps) {}

  async run(input: RunSyncInput): Promise<SyncRunOutcome> {
    const { deps } = this;
    const startedAt = deps.clock.now();

    // Resolved before the lease so the run records the mode it actually used.
    // This is a single indexed read, not an API call, so it does not weaken the
    // "reject a duplicate trigger before spending a request" property below.
    const mode = await this.resolveMode(input);

    // Acquiring the lease first means a duplicate trigger is rejected before it
    // spends a single Google API call.
    const lease = await deps.syncRuns.acquire(
      input.userId,
      input.trigger,
      mode,
      deps.config.leaseTtlSeconds,
    );

    const logger = deps.logger.child({
      syncRunId: lease.syncRunId,
      userId: input.userId,
      mode,
    });

    const stopHeartbeat = this.startHeartbeat(lease.syncRunId, logger);

    const runIssues: SyncIssue[] = [];
    let courseResults: CourseSyncResult[] = [];
    let counts = EMPTY_SYNC_COUNTS;

    try {
      const student = await this.loadStudentProfile(input.userId, runIssues, logger);

      // Phase one: discovery. Always runs, always cheap -- one paginated call.
      // The student cannot choose subjects they have not been shown.
      const discovery = await deps.discovery.discover(input.userId, lease.syncRunId);
      runIssues.push(...discovery.issues);

      // Phase two: coursework, for tracked subjects only. Everything expensive
      // -- topics, coursework pages, submission pages, classification -- happens
      // below this line, and only for courses the student opted into.
      const allCourses = await deps.courses.listForUser(input.userId, deps.source.id);
      const trackedIds = await deps.tracking.listTrackedCourseIds(input.userId);
      const storedCourses = allCourses.filter((course) => trackedIds.has(course.id));

      logger.info('courses discovered', {
        discovered: discovery.courses.length,
        tracked: storedCourses.length,
        undecided: discovery.undecidedCount,
        completeness: discovery.completeness,
      });

      if (storedCourses.length === 0 && discovery.courses.length > 0) {
        // Not a failure. The student has courses but has not chosen any yet,
        // and saying so plainly is more useful than an empty successful sync.
        runIssues.push({
          code: 'NO_TRACKED_COURSES',
          message:
            'No courses are being tracked. Choose the subjects to follow before synchronising coursework.',
          retryable: false,
          scope: 'RUN',
          sourceCourseId: null,
          sourceItemId: null,
        });
      }

      // Bounded concurrency, not Promise.all. A student with twenty courses
      // would otherwise open twenty simultaneous Classroom conversations, each
      // of which is itself several paginated requests.
      const settled = await mapWithConcurrency(
        storedCourses,
        deps.config.courseConcurrency,
        async (course) =>
          this.syncCourse({
            course,
            lease,
            input,
            mode,
            student,
            logger,
          }),
      );

      courseResults = settled.map((entry, index) => {
        const course = storedCourses[index] as StoredCourse;
        if (entry.status === 'fulfilled') return entry.value;

        const error = toAppError(entry.reason);
        logger.error('course synchronisation failed', {
          sourceCourseId: course.sourceCourseId,
          errorCode: error.code,
          message: error.message,
        });

        return {
          sourceCourseId: course.sourceCourseId,
          courseName: course.name,
          status: 'FAILED',
          completeness: 'FAILED',
          counts: { ...EMPTY_SYNC_COUNTS, coursesProcessed: 1, coursesFailed: 1 },
          issues: [
            {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              scope: 'COURSE',
              sourceCourseId: course.sourceCourseId,
              sourceItemId: null,
            },
          ],
        } satisfies CourseSyncResult;
      });

      for (const result of courseResults) {
        counts = addCounts(counts, result.counts);
        await deps.syncRuns.recordCourseResult(lease.syncRunId, result);
        if (result.issues.length > 0) {
          await deps.syncRuns.recordIssues(lease.syncRunId, result.issues);
        }
      }

      if (runIssues.length > 0) {
        await deps.syncRuns.recordIssues(lease.syncRunId, runIssues);
      }

      const status = resolveRunStatus(courseResults);
      const finishedAt = deps.clock.now();
      await deps.syncRuns.finalize(lease.syncRunId, status, counts, finishedAt);

      logger.info('sync run finished', { status, ...counts });

      return {
        syncRunId: lease.syncRunId,
        userId: input.userId,
        trigger: input.trigger,
        mode,
        status,
        startedAt,
        finishedAt,
        counts,
        courses: courseResults,
        issues: runIssues,
      };
    } catch (caught) {
      // A run-level failure (revoked token, course listing unreachable) still
      // gets finalised with everything learned so far, so the record is never
      // left RUNNING and the student is told what actually happened.
      const error = toAppError(caught);
      const issue: SyncIssue = {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        scope: 'RUN',
        sourceCourseId: null,
        sourceItemId: null,
      };
      runIssues.push(issue);

      logger.error('sync run failed', { errorCode: error.code, message: error.message });

      await safely(() => deps.syncRuns.recordIssues(lease.syncRunId, [issue]), logger);
      const finishedAt = deps.clock.now();
      await safely(
        () => deps.syncRuns.finalize(lease.syncRunId, 'FAILED', counts, finishedAt),
        logger,
      );

      return {
        syncRunId: lease.syncRunId,
        userId: input.userId,
        trigger: input.trigger,
        mode,
        status: 'FAILED',
        startedAt,
        finishedAt,
        counts,
        courses: courseResults,
        issues: runIssues,
      };
    } finally {
      stopHeartbeat();
    }
  }

  // ---------------------------------------------------------------------------

  private async syncCourse(args: {
    course: StoredCourse;
    lease: { syncRunId: string };
    input: RunSyncInput;
    mode: SyncMode;
    student: StudentSectionProfile | null;
    logger: Logger;
  }): Promise<CourseSyncResult> {
    const { deps } = this;
    const { course, lease, input, student } = args;
    const logger = args.logger.child({ sourceCourseId: course.sourceCourseId });

    let counts: SyncCounts = { ...EMPTY_SYNC_COUNTS, coursesProcessed: 1 };
    const issues: SyncIssue[] = [];

    const updatedSince = args.mode === 'INCREMENTAL' ? course.courseworkWatermark : null;

    const content = await deps.source.fetchCourseContent(
      { userId: input.userId, syncRunId: lease.syncRunId },
      { sourceCourseId: course.sourceCourseId, name: course.name },
      { updatedSince },
    );

    issues.push(...content.issues);
    counts = addCounts(counts, { itemsRejectedByValidation: content.rejectedItemCount });

    if (content.observedSourceUserId !== null && input.onSourceUserIdObserved !== undefined) {
      await safely(
        () => input.onSourceUserIdObserved?.(content.observedSourceUserId as string),
        logger,
      );
    }

    const syncedAt = deps.clock.now();

    // Topics first: assignment rows reference them, and the topic name feeds
    // the classifier.
    await deps.courses.upsertTopics(input.userId, course.id, content.topics, syncedAt);

    const upsert = await deps.assignments.upsertMany(
      input.userId,
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
      input.userId,
      course.id,
      content.submissions,
      syncedAt,
    );
    counts = addCounts(counts, { submissionsUpserted: submissionResult.upserted });

    // Only a listing that enumerated the whole course may conclude that an
    // absent item was removed. Anything else -- an incremental prefix, a
    // truncated page sweep -- carries no information about absence at all.
    if (content.completeness === 'COMPLETE') {
      const seen = content.assignments.map((assignment) => assignment.sourceItemId);
      const reconciled = await deps.assignments.reconcileMissing(
        input.userId,
        course.id,
        seen,
        content.completeness,
        syncedAt,
      );
      counts = addCounts(counts, { assignmentsMarkedMissing: reconciled.markedMissing });
    }

    if (student !== null) {
      const classificationCounts = await this.classifyCourse({
        userId: input.userId,
        googleUserId: input.googleUserId ?? null,
        student,
        course,
        records: content.assignments,
        topicNames: new Map(content.topics.map((topic) => [topic.sourceTopicId, topic.name])),
        upsertedIds: new Map(upsert.rows.map((row) => [row.sourceItemId, row.assignmentId])),
        logger,
      });
      counts = addCounts(counts, classificationCounts);
    }

    // The watermark advances even for a partial listing: ordering by update time
    // descending means everything newer than the previous watermark was seen.
    if (content.highWatermark !== null) {
      const next =
        course.courseworkWatermark === null ||
        content.highWatermark > course.courseworkWatermark
          ? content.highWatermark
          : course.courseworkWatermark;
      await deps.courses.setCourseworkWatermark(input.userId, course.id, next);
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
   * queries per course regardless of how many assignments it holds: one to read
   * existing fingerprints, one to read overrides. Classification itself is pure
   * and runs in process.
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
      // version and the student's alias set. A cheaper check would leave stale
      // verdicts behind after a rule fix, which is the one caching mistake that
      // produces confidently wrong output.
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
        // The resolver reports a conflict as an UNCERTAIN scope; the flag is
        // kept so the two causes of UNCERTAIN stay distinguishable in the data.
        conflicted: decision.scopeRule === 'SCOPE_CONFLICT',
        rulesetVersion: decision.rulesetVersion,
        inputFingerprint: fingerprint,
        // Stored beside the verdict, not merged into it: what the coursework
        // targeted is a fact about the assignment, independent of this student.
        scopeType: decision.scope.type,
        scopeSections: sectionsOf(decision.scope),
        scopeRule: decision.scopeRule,
        scopeConfidence: decision.scopeConfidence,
      });
    }

    if (rows.length === 0) return {};

    const written = await deps.classifications.upsertMany(args.userId, rows);

    args.logger.debug('classified coursework', {
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
   * rule set has moved on since those verdicts were written, the items Google
   * did not touch would keep their old classification forever -- the exact
   * "stale verdict survives a rule fix" failure the fingerprint scheme exists to
   * prevent. Escalating to a full pass is the only way the fix reaches them.
   */
  private async resolveMode(input: RunSyncInput): Promise<SyncMode> {
    if (input.mode === 'FULL') return 'FULL';

    const stale = await this.deps.classifications.hasStaleRuleset(
      input.userId,
      this.deps.classifier.version,
    );
    if (!stale) return 'INCREMENTAL';

    this.deps.logger.info('escalating to a full sync: stored verdicts predate the rule set', {
      userId: input.userId,
      rulesetVersion: this.deps.classifier.version,
    });
    return 'FULL';
  }

  /**
   * A missing academic profile does not abort the run.
   *
   * Source data is still worth ingesting -- it is the student's coursework
   * either way. What we will not do is classify without knowing their section,
   * because every verdict would be an invention. Unclassified assignments read
   * back as UNCERTAIN, which is the honest answer.
   */
  private async loadStudentProfile(
    userId: string,
    runIssues: SyncIssue[],
    logger: Logger,
  ): Promise<StudentSectionProfile | null> {
    const profile = await this.deps.profiles.findByUserId(userId);
    if (profile === null) {
      logger.warn('no academic profile; coursework will be synced but not classified', {
        userId,
      });
      runIssues.push({
        code: 'NO_ACADEMIC_PROFILE',
        message:
          'No academic profile is configured, so relevance was not evaluated. Coursework was still synchronised.',
        retryable: false,
        scope: 'RUN',
        sourceCourseId: null,
        sourceItemId: null,
      });
      return null;
    }

    return buildStudentSectionProfile(profile.identity, profile.aliases);
  }

  private startHeartbeat(syncRunId: string, logger: Logger): () => void {
    const intervalMs = Math.max(15_000, (this.deps.config.leaseTtlSeconds * 1000) / 3);

    const schedule =
      this.deps.scheduleHeartbeat ??
      ((fn: () => void, ms: number): (() => void) => {
        const timer = setInterval(fn, ms);
        // Never keep the process alive for a heartbeat.
        timer.unref?.();
        return () => clearInterval(timer);
      });

    return schedule(() => {
      void this.deps.syncRuns.heartbeat(syncRunId).catch((cause: unknown) => {
        logger.warn('heartbeat failed', { errorCode: toAppError(cause).code });
      });
    }, intervalMs);
  }
}

/**
 * The sections a scope names: targeted for SPECIFIC_SECTIONS, excluded for
 * ALL_SECTIONS_EXCEPT. The column is interpreted through scope_type, and the
 * database CHECK keeps the two in step.
 */
function sectionsOf(scope: RelevanceDecision['scope']): string[] {
  if (scope.type === 'SPECIFIC_SECTIONS') return [...scope.sections];
  if (scope.type === 'ALL_SECTIONS_EXCEPT') return [...scope.excluded];
  return [];
}

/** Best-effort bookkeeping must never mask the real failure. */
async function safely(fn: () => Promise<unknown> | undefined, logger: Logger): Promise<void> {
  try {
    await fn();
  } catch (cause) {
    logger.warn('non-critical operation failed', { errorCode: toAppError(cause).code });
  }
}
