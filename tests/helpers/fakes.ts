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
  SyncRunLease,
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
  SyncCounts,
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

export class FakeSyncRunRepository implements SyncRunRepository {
  active: string | null = null;
  finalized: Array<{ status: SyncRunStatus; counts: SyncCounts }> = [];
  courseResults: CourseSyncResult[] = [];
  issues: SyncIssue[] = [];
  heartbeats = 0;
  private sequence = 0;

  acquire(userId: string, _trigger: SyncTrigger, mode: SyncMode): Promise<SyncRunLease> {
    // Mirrors the partial unique index: a second concurrent run is refused.
    if (this.active !== null) {
      return Promise.reject(new SyncAlreadyRunningError('already running'));
    }
    this.sequence += 1;
    this.active = `run-${String(this.sequence)}`;
    return Promise.resolve({
      syncRunId: this.active,
      userId,
      startedAt: new Date('2026-03-01T00:00:00Z'),
      mode,
    });
  }

  heartbeat(): Promise<void> {
    this.heartbeats += 1;
    return Promise.resolve();
  }

  recordCourseResult(_syncRunId: string, result: CourseSyncResult): Promise<void> {
    this.courseResults.push(result);
    return Promise.resolve();
  }

  recordIssues(_syncRunId: string, issues: readonly SyncIssue[]): Promise<void> {
    this.issues.push(...issues);
    return Promise.resolve();
  }

  finalize(_syncRunId: string, status: SyncRunStatus, counts: SyncCounts): Promise<void> {
    this.finalized.push({ status, counts });
    this.active = null;
    return Promise.resolve();
  }

  latestForUser(): Promise<SyncRunSummary | null> {
    return Promise.resolve(null);
  }

  lastSuccessfulAt(): Promise<Date | null> {
    return Promise.resolve(null);
  }
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
