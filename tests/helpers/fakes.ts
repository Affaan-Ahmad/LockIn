import type {
  AcademicProfileInput,
  AcademicProfileRecord,
  AcademicProfileRepository,
  AssignmentRepository,
  AssignmentUpsertResult,
  ClassificationRepository,
  ClassificationRow,
  CourseRepository,
  CourseTrackingRepository,
  StoredCourse,
  SubmissionRepository,
  SyncCourseQueueEntry,
  SyncCourseWorkItem,
  SyncRunLease,
  SyncRunProgress,
  SyncRunRepository,
  SyncRunSummary,
  UndatedAssignment,
  UpcomingAssignment,
} from '@/application/ports/repositories';
import type {
  AcademicSourceAdapter,
  FetchCourseContentOptions,
  SourceCourseContent,
  SourceCourseListing,
  SourceCourseRef,
} from '@/application/ports/source-adapter';
import type { ListingCompleteness } from '@/domain/assignment/lifecycle';
import type {
  AcademicSourceId,
  AssignmentSourceRecord,
  CourseSourceRecord,
  SubmissionSourceRecord,
  TopicSourceRecord,
} from '@/domain/assignment/types';
import type { ManualOverride } from '@/domain/classification/relevance';
import type { DiscoveredCourse, TrackingDecision } from '@/domain/course/tracking';
import type {
  CourseSyncResult,
  CourseSyncStatus,
  SyncIssue,
  SyncMode,
  SyncRunStatus,
  SyncTrigger,
} from '@/domain/sync/outcome';
import { SyncAlreadyRunningError } from '@/shared/errors';

/**
 * In-memory doubles for the ports.
 *
 * Their existence is the practical proof that the layering works: the sync
 * service can be exercised end to end with no Google, no Postgres and no
 * network. If any of these fakes were awkward to write, that would be a signal
 * that a port had leaked an infrastructure concern.
 */

export class FakeSourceAdapter implements AcademicSourceAdapter {
  readonly id: AcademicSourceId = 'GOOGLE_CLASSROOM';

  courses: CourseSourceRecord[] = [];
  contentByCourse = new Map<string, SourceCourseContent>();
  failCourses = new Set<string>();
  listCoursesError: Error | null = null;
  fetchCalls: Array<{ courseId: string; updatedSince: Date | null }> = [];

  listCourses(): Promise<SourceCourseListing> {
    if (this.listCoursesError !== null) return Promise.reject(this.listCoursesError);
    return Promise.resolve({
      courses: this.courses,
      completeness: 'COMPLETE',
      issues: [],
    });
  }

  fetchCourseContent(
    _context: unknown,
    course: SourceCourseRef,
    options: FetchCourseContentOptions,
  ): Promise<SourceCourseContent> {
    this.fetchCalls.push({
      courseId: course.sourceCourseId,
      updatedSince: options.updatedSince,
    });

    if (this.failCourses.has(course.sourceCourseId)) {
      return Promise.reject(new Error(`course ${course.sourceCourseId} is unreachable`));
    }

    return Promise.resolve(
      this.contentByCourse.get(course.sourceCourseId) ?? emptyCourseContent(),
    );
  }
}

export function emptyCourseContent(
  overrides: Partial<SourceCourseContent> = {},
): SourceCourseContent {
  return {
    assignments: [],
    topics: [],
    submissions: [],
    completeness: 'COMPLETE',
    highWatermark: null,
    issues: [],
    rejectedItemCount: 0,
    observedSourceUserId: null,
    ...overrides,
  };
}

export class FakeCourseRepository implements CourseRepository {
  stored = new Map<string, StoredCourse>();
  watermarks = new Map<string, Date | null>();
  topicCalls: Array<{ courseId: string; topics: readonly TopicSourceRecord[] }> = [];

  upsertMany(
    _userId: string,
    _source: AcademicSourceId,
    records: readonly CourseSourceRecord[],
  ): Promise<readonly StoredCourse[]> {
    const out: StoredCourse[] = [];
    for (const record of records) {
      const existing = this.stored.get(record.sourceCourseId);
      const stored: StoredCourse = {
        id: existing?.id ?? `course-${record.sourceCourseId}`,
        sourceCourseId: record.sourceCourseId,
        name: record.name,
        section: record.section,
        courseworkWatermark: existing?.courseworkWatermark ?? null,
        lifecycleStatus: 'ACTIVE',
      };
      this.stored.set(record.sourceCourseId, stored);
      out.push(stored);
    }
    return Promise.resolve(out);
  }

  listForUser(): Promise<readonly StoredCourse[]> {
    return Promise.resolve([...this.stored.values()]);
  }

  setCourseworkWatermark(
    _userId: string,
    courseId: string,
    watermark: Date | null,
  ): Promise<void> {
    this.watermarks.set(courseId, watermark);
    return Promise.resolve();
  }

  upsertTopics(
    _userId: string,
    courseId: string,
    topics: readonly TopicSourceRecord[],
  ): Promise<void> {
    this.topicCalls.push({ courseId, topics });
    return Promise.resolve();
  }
}

export class FakeAssignmentRepository implements AssignmentRepository {
  rows = new Map<string, AssignmentSourceRecord>();
  fingerprints = new Map<string, string>();
  reconcileCalls: Array<{
    courseId: string;
    seen: readonly string[];
    completeness: ListingCompleteness;
  }> = [];
  missing = new Set<string>();

  upsertMany(
    _userId: string,
    _courseId: string,
    records: readonly AssignmentSourceRecord[],
  ): Promise<AssignmentUpsertResult> {
    let created = 0;
    let updated = 0;

    const rows = records.map((record) => {
      const isNew = !this.rows.has(record.sourceItemId);
      if (isNew) created += 1;
      else updated += 1;
      this.rows.set(record.sourceItemId, record);
      this.missing.delete(record.sourceItemId);
      return {
        assignmentId: `assignment-${record.sourceItemId}`,
        sourceItemId: record.sourceItemId,
        created: isNew,
        changed: true,
      };
    });

    return Promise.resolve({ rows, created, updated, unchanged: 0 });
  }

  reconcileMissing(
    _userId: string,
    courseId: string,
    seenSourceItemIds: readonly string[],
    completeness: ListingCompleteness,
  ): Promise<{ readonly markedMissing: number }> {
    this.reconcileCalls.push({ courseId, seen: seenSourceItemIds, completeness });

    let marked = 0;
    for (const id of this.rows.keys()) {
      if (!seenSourceItemIds.includes(id)) {
        this.missing.add(id);
        marked += 1;
      }
    }
    return Promise.resolve({ markedMissing: marked });
  }

  findUpcoming(): Promise<readonly UpcomingAssignment[]> {
    return Promise.resolve([]);
  }

  findUndated(): Promise<readonly UndatedAssignment[]> {
    return Promise.resolve([]);
  }

  findOverdue(): Promise<readonly UpcomingAssignment[]> {
    return Promise.resolve([]);
  }

  ignored = new Set<string>();

  findIgnored(): Promise<readonly UpcomingAssignment[]> {
    return Promise.resolve([]);
  }

  setIgnored(_userId: string, assignmentId: string, ignored: boolean): Promise<void> {
    if (ignored) this.ignored.add(assignmentId);
    else this.ignored.delete(assignmentId);
    return Promise.resolve();
  }
}

/**
 * Tracking starts empty on purpose: a course is only synchronised once a test
 * says the student chose it, which is exactly the production default.
 *
 * Reads its course list from the course repository the way the real one reads
 * it from a join, so "discovered" and "tracked" cannot drift apart in a test
 * the way they could if the fake kept its own private list.
 */
export class FakeCourseTrackingRepository implements CourseTrackingRepository {
  tracked = new Set<string>();
  writes: Array<{ courseId: string; decision: TrackingDecision }> = [];

  constructor(private readonly courses?: FakeCourseRepository) {}

  listDiscovered(): Promise<readonly DiscoveredCourse[]> {
    const stored = [...(this.courses?.stored.values() ?? [])];
    return Promise.resolve(
      stored.map((course) => ({
        courseId: course.id,
        sourceCourseId: course.sourceCourseId,
        name: course.name,
        section: course.section,
        courseState: 'ACTIVE',
        decision: this.tracked.has(course.id) ? 'TRACKED' : 'NOT_TRACKED',
        decidedAt: this.tracked.has(course.id) ? new Date('2026-02-01T00:00:00Z') : null,
        lastSyncedAt: new Date('2026-03-01T12:00:00Z'),
      })),
    );
  }

  listTrackedCourseIds(): Promise<ReadonlySet<string>> {
    return Promise.resolve(this.tracked);
  }

  setTracking(
    _userId: string,
    decisions: readonly { courseId: string; decision: TrackingDecision }[],
  ): Promise<number> {
    for (const entry of decisions) {
      this.writes.push(entry);
      if (entry.decision === 'TRACKED') this.tracked.add(entry.courseId);
      else this.tracked.delete(entry.courseId);
    }
    return Promise.resolve(decisions.length);
  }
}

export class FakeSubmissionRepository implements SubmissionRepository {
  records: SubmissionSourceRecord[] = [];

  upsertMany(
    _userId: string,
    _courseId: string,
    records: readonly SubmissionSourceRecord[],
  ): Promise<{ readonly upserted: number }> {
    this.records.push(...records);
    return Promise.resolve({ upserted: records.length });
  }
}

export class FakeClassificationRepository implements ClassificationRepository {
  fingerprints = new Map<string, string>();
  overrides = new Map<string, ManualOverride>();
  written: ClassificationRow[] = [];
  /** Set by a test to simulate stored verdicts from an older rule set. */
  staleRuleset = false;

  loadFingerprints(
    _userId: string,
    assignmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>();
    for (const id of assignmentIds) {
      const value = this.fingerprints.get(id);
      if (value !== undefined) out.set(id, value);
    }
    return Promise.resolve(out);
  }

  hasStaleRuleset(): Promise<boolean> {
    return Promise.resolve(this.staleRuleset);
  }

  upsertMany(_userId: string, rows: readonly ClassificationRow[]): Promise<number> {
    for (const row of rows) {
      this.written.push(row);
      this.fingerprints.set(row.assignmentId, row.inputFingerprint);
    }
    return Promise.resolve(rows.length);
  }

  loadOverrides(
    _userId: string,
    assignmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ManualOverride>> {
    const out = new Map<string, ManualOverride>();
    for (const id of assignmentIds) {
      const value = this.overrides.get(id);
      if (value !== undefined) out.set(id, value);
    }
    return Promise.resolve(out);
  }
}

export class FakeAcademicProfileRepository implements AcademicProfileRepository {
  profile: AcademicProfileRecord | null = {
    userId: 'user-1',
    identity: { primarySection: 'G', programCode: 'BCS', batch: '4' },
    aliases: [],
    timeZone: 'Asia/Karachi',
  };

  findByUserId(): Promise<AcademicProfileRecord | null> {
    return Promise.resolve(this.profile);
  }

  upsert(userId: string, input: AcademicProfileInput): Promise<AcademicProfileRecord> {
    this.profile = {
      userId,
      identity: {
        primarySection: input.primarySection,
        programCode: input.programCode,
        batch: input.batch,
      },
      aliases: this.profile?.aliases ?? [],
      timeZone: input.timeZone,
    };
    return Promise.resolve(this.profile);
  }

  replaceAliases(_userId: string, aliases: readonly string[]): Promise<number> {
    return Promise.resolve(aliases.length);
  }
}

/**
 * An in-memory stand-in for the durable sync store.
 *
 * Models the three properties the real implementation enforces in SQL, because
 * they are the ones the service's correctness rests on and a fake that ignored
 * them would let broken code pass:
 *
 *   Fencing. Every mutation checks the owner token, so a test can simulate a
 *   worker that lost its lease and watch its writes get refused.
 *
 *   Derived status. finalize() computes the outcome from the work queue rather
 *   than accepting one, so no test can assert a SUCCESS the real database would
 *   have refused to record.
 *
 *   Single active run. start() refuses while a run is QUEUED or RUNNING, which
 *   is what the partial unique index does.
 */
export class FakeSyncRunRepository implements SyncRunRepository {
  runs = new Map<string, FakeRun>();
  issues: SyncIssue[] = [];
  renewals = 0;
  /** Set true to simulate this worker having been replaced. */
  fenceEverything = false;

  private sequence = 0;
  private ownerSequence = 0;

  start(
    userId: string,
    _trigger: SyncTrigger,
    mode: SyncMode,
    _leaseTtlSeconds: number,
    owner: string,
  ): Promise<SyncRunLease> {
    for (const run of this.runs.values()) {
      if (run.userId === userId && (run.status === 'QUEUED' || run.status === 'RUNNING')) {
        return Promise.reject(new SyncAlreadyRunningError('already running'));
      }
    }

    this.sequence += 1;
    const syncRunId = `run-${String(this.sequence)}`;
    this.runs.set(syncRunId, {
      syncRunId,
      userId,
      mode,
      status: 'RUNNING',
      owner,
      courses: [],
      discoveryCompleted: false,
      resumeAttempts: 0,
      finalStatus: null,
    });

    return Promise.resolve(this.leaseOf(syncRunId, owner));
  }

  resume(userId: string, _leaseTtlSeconds: number, owner: string): Promise<SyncRunLease | null> {
    for (const run of this.runs.values()) {
      if (run.userId !== userId || run.status !== 'QUEUED') continue;

      run.status = 'RUNNING';
      run.owner = owner;
      run.resumeAttempts += 1;
      // A course the previous worker was mid-way through goes back on the
      // queue; its work was idempotent, so redoing it is safe.
      for (const course of run.courses) {
        if (course.status === 'RUNNING') course.status = 'PENDING';
      }
      return Promise.resolve(this.leaseOf(run.syncRunId, owner));
    }
    return Promise.resolve(null);
  }

  renewLease(syncRunId: string, owner: string, _leaseTtlSeconds = 0): Promise<boolean> {
    this.renewals += 1;
    return Promise.resolve(this.owns(syncRunId, owner));
  }

  releaseLease(syncRunId: string, owner: string): Promise<boolean> {
    if (!this.owns(syncRunId, owner)) return Promise.resolve(false);
    const run = this.runs.get(syncRunId) as FakeRun;
    run.status = 'QUEUED';
    run.owner = null;
    return Promise.resolve(true);
  }

  enqueueCourses(
    syncRunId: string,
    owner: string,
    items: readonly SyncCourseQueueEntry[],
  ): Promise<number> {
    if (!this.owns(syncRunId, owner)) return Promise.resolve(0);
    const run = this.runs.get(syncRunId) as FakeRun;

    let added = 0;
    for (const item of items) {
      // Idempotent, exactly like ON CONFLICT DO NOTHING: re-enqueueing must not
      // duplicate a work item or reset one that already finished.
      if (run.courses.some((course) => course.sourceCourseId === item.sourceCourseId)) continue;
      run.courses.push({
        sourceCourseId: item.sourceCourseId,
        courseId: item.courseId,
        courseName: item.courseName,
        status: 'PENDING',
        attempts: 0,
        result: null,
      });
      added += 1;
    }

    run.discoveryCompleted = true;
    return Promise.resolve(added);
  }

  claimNextCourse(syncRunId: string, owner: string): Promise<SyncCourseWorkItem | null> {
    if (!this.owns(syncRunId, owner)) return Promise.resolve(null);
    const run = this.runs.get(syncRunId) as FakeRun;

    const next = run.courses.find((course) => course.status === 'PENDING');
    if (next === undefined) return Promise.resolve(null);

    next.status = 'RUNNING';
    next.attempts += 1;

    return Promise.resolve({
      sourceCourseId: next.sourceCourseId,
      courseId: next.courseId,
      courseName: next.courseName,
      attempts: next.attempts,
    });
  }

  completeCourse(
    syncRunId: string,
    owner: string,
    result: CourseSyncResult,
  ): Promise<boolean> {
    if (!this.owns(syncRunId, owner)) return Promise.resolve(false);
    const run = this.runs.get(syncRunId) as FakeRun;

    const item = run.courses.find((course) => course.sourceCourseId === result.sourceCourseId);
    if (item === undefined) return Promise.resolve(false);

    item.status = result.status;
    item.result = result;
    return Promise.resolve(true);
  }

  recordIssues(_syncRunId: string, issues: readonly SyncIssue[]): Promise<void> {
    this.issues.push(...issues);
    return Promise.resolve();
  }

  finalize(
    syncRunId: string,
    owner: string,
    _errorSummary: string | null = null,
  ): Promise<SyncRunStatus | null> {
    if (!this.owns(syncRunId, owner)) return Promise.resolve(null);
    const run = this.runs.get(syncRunId) as FakeRun;

    // Refuses while work remains, so a worker cannot finalise a run it has
    // merely stopped working on.
    if (run.courses.some((c) => c.status === 'PENDING' || c.status === 'RUNNING')) {
      return Promise.resolve(null);
    }

    const failed = run.courses.filter((course) => course.status === 'FAILED').length;
    const status: SyncRunStatus = !run.discoveryCompleted
      ? 'FAILED'
      : run.courses.length === 0 || failed === 0
        ? 'SUCCESS'
        : failed === run.courses.length
          ? 'FAILED'
          : 'PARTIAL_SUCCESS';

    run.status = status;
    run.finalStatus = status;
    run.owner = null;
    return Promise.resolve(status);
  }

  failRun(syncRunId: string, owner: string): Promise<boolean> {
    if (!this.owns(syncRunId, owner)) return Promise.resolve(false);
    const run = this.runs.get(syncRunId) as FakeRun;
    run.status = 'FAILED';
    run.finalStatus = 'FAILED';
    run.owner = null;
    for (const course of run.courses) {
      if (course.status === 'PENDING' || course.status === 'RUNNING') course.status = 'FAILED';
    }
    return Promise.resolve(true);
  }

  progress(syncRunId: string): Promise<SyncRunProgress | null> {
    const run = this.runs.get(syncRunId);
    if (run === undefined) return Promise.resolve(null);

    return Promise.resolve({
      syncRunId,
      status: run.status,
      mode: run.mode,
      startedAt: new Date('2026-03-01T00:00:00Z'),
      finishedAt: run.finalStatus === null ? null : new Date('2026-03-01T00:01:00Z'),
      counts: null,
      totalCourses: run.courses.length,
      completedCourses: run.courses.filter((c) => c.status === 'SUCCESS').length,
      failedCourses: run.courses.filter((c) => c.status === 'FAILED').length,
      errorSummary: null,
      issueCodes: [...new Set(this.issues.map((issue) => issue.code))],
    });
  }

  latestForUser(): Promise<SyncRunSummary | null> {
    return Promise.resolve(null);
  }

  lastSuccessfulAt(): Promise<Date | null> {
    return Promise.resolve(null);
  }

  findResumableUserIds(): Promise<readonly string[]> {
    const ids = [...this.runs.values()]
      .filter((run) => run.status === 'QUEUED')
      .map((run) => run.userId);
    return Promise.resolve([...new Set(ids)]);
  }

  // --- test helpers ---------------------------------------------------------

  /** The results a run actually recorded, in completion order. */
  resultsOf(syncRunId: string): CourseSyncResult[] {
    const run = this.runs.get(syncRunId);
    if (run === undefined) return [];
    return run.courses
      .map((course) => course.result)
      .filter((result): result is CourseSyncResult => result !== null);
  }

  runFor(userId: string): FakeRun | undefined {
    return [...this.runs.values()].find((run) => run.userId === userId);
  }

  /** Simulates the lease being taken over by another worker. */
  stealLease(syncRunId: string): string {
    const run = this.runs.get(syncRunId) as FakeRun;
    this.ownerSequence += 1;
    run.owner = `thief-${String(this.ownerSequence)}`;
    run.status = 'RUNNING';
    return run.owner;
  }

  private owns(syncRunId: string, owner: string): boolean {
    if (this.fenceEverything) return false;
    const run = this.runs.get(syncRunId);
    return run !== undefined && run.owner === owner && run.status === 'RUNNING';
  }

  private leaseOf(syncRunId: string, owner: string): SyncRunLease {
    const run = this.runs.get(syncRunId) as FakeRun;
    return {
      syncRunId,
      userId: run.userId,
      owner,
      startedAt: new Date('2026-03-01T00:00:00Z'),
      mode: run.mode,
      discoveryCompleted: run.discoveryCompleted,
      resumeAttempts: run.resumeAttempts,
    };
  }
}

export interface FakeRun {
  syncRunId: string;
  userId: string;
  mode: SyncMode;
  status: SyncRunStatus;
  owner: string | null;
  courses: FakeCourseWorkItem[];
  discoveryCompleted: boolean;
  resumeAttempts: number;
  finalStatus: SyncRunStatus | null;
}

export interface FakeCourseWorkItem {
  sourceCourseId: string;
  courseId: string | null;
  courseName: string | null;
  status: CourseSyncStatus;
  attempts: number;
  result: CourseSyncResult | null;
}

export function assignmentRecord(
  overrides: Partial<AssignmentSourceRecord> = {},
): AssignmentSourceRecord {
  return {
    source: 'GOOGLE_CLASSROOM',
    sourceItemId: 'w1',
    sourceCourseId: 'c1',
    title: 'Assignment 1',
    description: null,
    workType: 'ASSIGNMENT',
    sourceState: 'PUBLISHED',
    maxPoints: null,
    alternateLink: null,
    sourceTopicId: null,
    assigneeMode: null,
    individualStudentIds: null,
    deadline: { precision: 'NONE', dueDate: null, dueTime: null, dueAt: null },
    sourceCreatedAt: null,
    sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  };
}

export function courseRecord(overrides: Partial<CourseSourceRecord> = {}): CourseSourceRecord {
  return {
    source: 'GOOGLE_CLASSROOM',
    sourceCourseId: 'c1',
    name: 'Data Structures',
    section: null,
    descriptionHeading: null,
    room: null,
    courseState: 'ACTIVE',
    alternateLink: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    ...overrides,
  };
}
