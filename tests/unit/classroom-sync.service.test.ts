import { describe, expect, it } from 'vitest';

import { ClassroomSyncService } from '@/application/services/classroom-sync.service';
import { CourseDiscoveryService } from '@/application/services/course-discovery.service';
import { createRelevanceClassifier } from '@/domain/classification/registry';
import type {
  CourseSyncResult,
  SyncCounts,
  SyncIssue,
  SyncRunStatus,
} from '@/domain/sync/outcome';
import { addCounts, EMPTY_SYNC_COUNTS } from '@/domain/sync/outcome';
import { fixedClock } from '@/shared/clock';
import { silentLogger } from '@/shared/logger';

import {
  assignmentRecord,
  courseRecord,
  emptyCourseContent,
  FakeAcademicProfileRepository,
  FakeAssignmentRepository,
  FakeClassificationRepository,
  FakeCourseRepository,
  FakeCourseTrackingRepository,
  FakeSourceAdapter,
  FakeSubmissionRepository,
  FakeSyncRunRepository,
} from '../helpers/fakes';

/**
 * The sync service tested with no Google and no database.
 *
 * Everything asserted here is a reliability property the brief calls out:
 * partial failure containment, deletion only on proof, overrides surviving,
 * bounded concurrency, and idempotent re-runs.
 */

function buildService(overrides: {
  source?: FakeSourceAdapter;
  courses?: FakeCourseRepository;
  assignments?: FakeAssignmentRepository;
  classifications?: FakeClassificationRepository;
  tracking?: FakeCourseTrackingRepository;
  profiles?: FakeAcademicProfileRepository;
  syncRuns?: FakeSyncRunRepository;
  invocationBudgetMs?: number;
  checkoutReserveMs?: number;
  initialUnitEstimateMs?: number;
} = {}) {
  const source = overrides.source ?? new FakeSourceAdapter();
  const courses = overrides.courses ?? new FakeCourseRepository();
  const assignments = overrides.assignments ?? new FakeAssignmentRepository();
  const submissions = new FakeSubmissionRepository();
  const classifications = overrides.classifications ?? new FakeClassificationRepository();
  const tracking = overrides.tracking ?? new FakeCourseTrackingRepository(courses);
  const profiles = overrides.profiles ?? new FakeAcademicProfileRepository();
  const syncRuns = overrides.syncRuns ?? new FakeSyncRunRepository();
  const clock = fixedClock('2026-03-01T12:00:00Z');

  const discovery = new CourseDiscoveryService({
    source,
    courses,
    tracking,
    logger: silentLogger,
    clock,
  });

  const service = new ClassroomSyncService({
    source,
    courses,
    assignments,
    submissions,
    classifications,
    tracking,
    discovery,
    profiles,
    syncRuns,
    classifier: createRelevanceClassifier(),
    logger: silentLogger,
    clock,
    config: {
      leaseTtlSeconds: 90,
      // Effectively unlimited unless a test narrows it, so the ordinary cases
      // exercise one invocation and the handover tests opt in explicitly.
      invocationBudgetMs: overrides.invocationBudgetMs ?? 3_600_000,
      checkoutReserveMs: overrides.checkoutReserveMs ?? 3_000,
      initialUnitEstimateMs: overrides.initialUnitEstimateMs ?? 1,
      maxCourseAttempts: 3,
    },
    // No real timers in tests.
    scheduleHeartbeat: () => () => undefined,
  });

  return {
    service,
    discovery,
    source,
    courses,
    assignments,
    submissions,
    classifications,
    tracking,
    profiles,
    syncRuns,
  };
}

/**
 * Every course the source offers, marked as tracked.
 *
 * Explicit in each test because that is the production reality: nothing is
 * synchronised until the student opts in, and a helper that hid this would hide
 * the most important new precondition in the pipeline.
 */
function trackAll(harness: ReturnType<typeof buildService>): void {
  for (const course of harness.source.courses) {
    harness.tracking.tracked.add(`course-${course.sourceCourseId}`);
  }
}

const RUN = { userId: 'user-1', trigger: 'MANUAL', mode: 'FULL' } as const;

/**
 * Starts a run and drives it to a terminal state, following handovers.
 *
 * Stands in for the continuation trigger: in production a handover provokes a
 * fresh invocation, and here it provokes another `work` call. Everything else
 * -- the queue, the fencing, the checkpoints -- is the real code path, which is
 * the point. A test that skipped the handover would never exercise resumption.
 *
 * Returns the shape the old single-shot `run()` returned, so the assertions in
 * this file continue to describe behaviour rather than plumbing.
 */
async function runSync(
  harness: ReturnType<typeof buildService>,
  input: { userId: string; trigger: 'MANUAL' | 'SCHEDULED' | 'ON_DEMAND'; mode: 'FULL' | 'INCREMENTAL' } = RUN,
): Promise<{
  syncRunId: string;
  status: SyncRunStatus;
  counts: SyncCounts;
  courses: CourseSyncResult[];
  issues: SyncIssue[];
  invocations: number;
}> {
  const lease = await harness.service.start(input);
  let outcome = await harness.service.work(lease, input);
  let invocations = 1;

  // Bounded: an unbounded loop here would turn a resumption bug into a hung
  // test suite instead of a failing assertion.
  while (outcome.kind === 'HANDED_OFF' && invocations < 50) {
    const next = await harness.service.resume(input.userId);
    if (next === null) break;
    outcome = await harness.service.work(next, input);
    invocations += 1;
  }

  const courses = harness.syncRuns.resultsOf(outcome.syncRunId);
  const run = harness.syncRuns.runs.get(outcome.syncRunId);

  return {
    syncRunId: outcome.syncRunId,
    status: run?.status ?? 'FAILED',
    counts: courses.reduce<SyncCounts>((total, result) => addCounts(total, result.counts), EMPTY_SYNC_COUNTS),
    courses,
    issues: harness.syncRuns.issues,
    invocations,
  };
}

describe('happy path', () => {
  it('synchronises and classifies coursework', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({
        assignments: [
          assignmentRecord({ sourceItemId: 'w1', title: 'Assignment 3 - G' }),
          assignmentRecord({ sourceItemId: 'w2', title: 'Assignment 3 - Section B' }),
          assignmentRecord({ sourceItemId: 'w3', title: 'Quiz 1' }),
        ],
      }),
    );

    trackAll(harness);
    const outcome = await runSync(harness);

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.counts.assignmentsCreated).toBe(3);
    expect(outcome.counts.relevantCount).toBe(2);
    expect(outcome.counts.notRelevantCount).toBe(1);

    const byId = new Map(
      harness.classifications.written.map((row) => [row.assignmentId, row.relevance]),
    );
    expect(byId.get('assignment-w1')).toBe('RELEVANT');
    expect(byId.get('assignment-w2')).toBe('NOT_RELEVANT');
    expect(byId.get('assignment-w3')).toBe('RELEVANT');
  });

  it('records a per-course result for observability', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];

    trackAll(harness);
    await runSync(harness);

    const recorded = harness.syncRuns.resultsOf('run-1');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      sourceCourseId: 'c1',
      status: 'SUCCESS',
      completeness: 'COMPLETE',
    });
  });
});

describe('partial failure', () => {
  it('keeps the successful courses when one course fails', async () => {
    const harness = buildService();
    harness.source.courses = [
      courseRecord({ sourceCourseId: 'c1' }),
      courseRecord({ sourceCourseId: 'c2', name: 'Networks' }),
      courseRecord({ sourceCourseId: 'c3', name: 'Databases' }),
    ];
    harness.source.failCourses.add('c2');
    for (const id of ['c1', 'c3']) {
      harness.source.contentByCourse.set(
        id,
        emptyCourseContent({
          assignments: [assignmentRecord({ sourceItemId: `${id}-w1`, sourceCourseId: id })],
        }),
      );
    }

    trackAll(harness);
    const outcome = await runSync(harness);

    // "Sync failed" would be a lie here and would throw away two courses of
    // real work.
    expect(outcome.status).toBe('PARTIAL_SUCCESS');
    expect(outcome.counts.coursesSucceeded).toBe(2);
    expect(outcome.counts.coursesFailed).toBe(1);
    expect(outcome.counts.assignmentsCreated).toBe(2);

    const failed = outcome.courses.find((course) => course.status === 'FAILED');
    expect(failed?.sourceCourseId).toBe('c2');
    expect(failed?.completeness).toBe('FAILED');
  });

  it('reports FAILED only when every course failed', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];
    harness.source.failCourses.add('c1');

    trackAll(harness);
    const outcome = await runSync(harness);
    expect(outcome.status).toBe('FAILED');
  });

  it('finalises the run and records the issue when course listing itself fails', async () => {
    const harness = buildService();
    harness.source.listCoursesError = new Error('classroom unreachable');

    trackAll(harness);
    const outcome = await runSync(harness);

    expect(outcome.status).toBe('FAILED');
    // The run must reach a terminal state and drop its lease. A run left
    // RUNNING and owned by a worker that has gone is the exact condition the
    // whole design exists to make impossible.
    expect(harness.syncRuns.runs.get(outcome.syncRunId)?.owner).toBeNull();
    expect(harness.syncRuns.issues.some((issue) => issue.scope === 'RUN')).toBe(true);
  });

  it('treats a run with no courses as a success', async () => {
    const harness = buildService();
    trackAll(harness);
    const outcome = await runSync(harness);
    expect(outcome.status).toBe('SUCCESS');
  });
});

describe('disappearance handling', () => {
  it('reconciles only when the listing was complete', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ assignments: [assignmentRecord()], completeness: 'COMPLETE' }),
    );

    trackAll(harness);
    await runSync(harness);
    expect(harness.assignments.reconcileCalls).toHaveLength(1);
  });

  it('never reconciles from a partial listing', async () => {
    // An incremental pass sees only a prefix. Reconciling from it would mark
    // almost every item in the course as missing on the first run.
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ assignments: [assignmentRecord()], completeness: 'PARTIAL' }),
    );

    trackAll(harness);
    await runSync(harness);
    expect(harness.assignments.reconcileCalls).toHaveLength(0);
  });

  it('does not reconcile a course whose fetch failed', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.failCourses.add('c1');

    trackAll(harness);
    await runSync(harness);
    expect(harness.assignments.reconcileCalls).toHaveLength(0);
  });
});

describe('manual overrides', () => {
  it('survives a full re-sync and still decides the verdict', async () => {
    // The single most important reliability test in the suite. Automated
    // synchronisation must never quietly undo what the student decided.
    const harness = buildService();
    harness.classifications.overrides.set('assignment-w2', {
      relevance: 'RELEVANT',
      note: 'my section was added late',
      decidedAt: new Date('2026-02-20T00:00:00Z'),
    });

    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({
        assignments: [assignmentRecord({ sourceItemId: 'w2', title: 'Assignment 3 - Section B' })],
      }),
    );

    trackAll(harness);
    await runSync(harness);
    trackAll(harness);
    await runSync(harness);

    const verdicts = harness.classifications.written.filter(
      (row) => row.assignmentId === 'assignment-w2',
    );
    expect(verdicts.length).toBeGreaterThan(0);
    for (const verdict of verdicts) {
      // Without the override this title classifies as NOT_RELEVANT.
      expect(verdict.relevance).toBe('RELEVANT');
      expect(verdict.decidedByRule).toBe('MANUAL_OVERRIDE');
    }

    // And the override itself is untouched: the sync path has no writer for it.
    expect(harness.classifications.overrides.get('assignment-w2')?.relevance).toBe('RELEVANT');
  });
});

describe('reclassification economy', () => {
  it('skips rules for items whose inputs are unchanged', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ assignments: [assignmentRecord({ title: 'Quiz 1' })] }),
    );

    trackAll(harness);
    await runSync(harness);
    const afterFirst = harness.classifications.written.length;

    trackAll(harness);
    await runSync(harness);
    expect(harness.classifications.written.length).toBe(afterFirst);
  });

  it('reclassifies when the title changes', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ assignments: [assignmentRecord({ title: 'Quiz 1' })] }),
    );
    trackAll(harness);
    await runSync(harness);

    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({
        assignments: [assignmentRecord({ title: 'Quiz 1 - Section B' })],
      }),
    );
    trackAll(harness);
    await runSync(harness);

    const last = harness.classifications.written.at(-1);
    expect(last?.relevance).toBe('NOT_RELEVANT');
  });
});

describe('incremental mode', () => {
  it('passes the stored watermark to the adapter', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.courses.stored.set('c1', {
      id: 'course-c1',
      sourceCourseId: 'c1',
      name: 'Data Structures',
      section: null,
      courseworkWatermark: new Date('2026-02-01T00:00:00Z'),
      lifecycleStatus: 'ACTIVE',
    });

    trackAll(harness);
    await runSync(harness, { ...RUN, mode: 'INCREMENTAL' });

    expect(harness.source.fetchCalls[0]?.updatedSince?.toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('ignores the watermark in FULL mode', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.courses.stored.set('c1', {
      id: 'course-c1',
      sourceCourseId: 'c1',
      name: 'Data Structures',
      section: null,
      courseworkWatermark: new Date('2026-02-01T00:00:00Z'),
      lifecycleStatus: 'ACTIVE',
    });

    trackAll(harness);
    await runSync(harness, { ...RUN, mode: 'FULL' });
    expect(harness.source.fetchCalls[0]?.updatedSince).toBeNull();
  });

  it('advances the watermark to the newest item seen', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ highWatermark: new Date('2026-03-01T00:00:00Z') }),
    );

    trackAll(harness);
    await runSync(harness);
    expect(harness.courses.watermarks.get('course-c1')?.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('never moves the watermark backwards', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.courses.stored.set('c1', {
      id: 'course-c1',
      sourceCourseId: 'c1',
      name: 'Data Structures',
      section: null,
      courseworkWatermark: new Date('2026-04-01T00:00:00Z'),
      lifecycleStatus: 'ACTIVE',
    });
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ highWatermark: new Date('2026-03-01T00:00:00Z') }),
    );

    trackAll(harness);
    await runSync(harness);

    // Rewinding it would re-read old coursework forever; worse, a bug that
    // rewound it far enough would look like nothing was ever synced.
    expect(harness.courses.watermarks.get('course-c1')?.toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });
});

describe('course tracking gates the expensive half', () => {
  it('fetches coursework only for tracked courses', async () => {
    const harness = buildService();
    harness.source.courses = [
      courseRecord({ sourceCourseId: 'c1', name: 'Operating Systems' }),
      courseRecord({ sourceCourseId: 'c2', name: 'Old Fall 2025 Class' }),
      courseRecord({ sourceCourseId: 'c3', name: 'Database Systems' }),
    ];
    harness.tracking.tracked.add('course-c1');
    harness.tracking.tracked.add('course-c3');

    const outcome = await runSync(harness);

    // The whole point: an untracked course costs one row in a discovery listing
    // and not a single coursework or submission request.
    expect(harness.source.fetchCalls.map((call) => call.courseId).sort()).toEqual(['c1', 'c3']);
    expect(outcome.counts.coursesProcessed).toBe(2);
  });

  it('discovers every course even though it syncs only some', async () => {
    const harness = buildService();
    harness.source.courses = [
      courseRecord({ sourceCourseId: 'c1' }),
      courseRecord({ sourceCourseId: 'c2' }),
    ];
    harness.tracking.tracked.add('course-c1');

    await runSync(harness);

    // Discovery must stay complete: the student cannot choose a subject the
    // application never told them about.
    expect(harness.courses.stored.size).toBe(2);
  });

  it('never fetches coursework when nothing is tracked', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];

    const outcome = await runSync(harness);

    expect(harness.source.fetchCalls).toHaveLength(0);
    // Not a failure -- the student simply has not chosen yet, and saying so is
    // more useful than an empty successful sync with no explanation.
    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.issues.some((issue) => issue.code === 'NO_TRACKED_COURSES')).toBe(true);
  });

  it('picks up a course as soon as it is tracked, with no other change', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ assignments: [assignmentRecord()] }),
    );

    await runSync(harness);
    expect(harness.source.fetchCalls).toHaveLength(0);

    harness.tracking.tracked.add('course-c1');
    const second = await runSync(harness);

    expect(harness.source.fetchCalls).toHaveLength(1);
    expect(second.counts.assignmentsCreated).toBe(1);
  });

  it('stops fetching a course the moment it is untracked', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];
    harness.tracking.tracked.add('course-c1');

    await runSync(harness);
    expect(harness.source.fetchCalls).toHaveLength(1);

    harness.tracking.tracked.delete('course-c1');
    await runSync(harness);

    // Still one: the second run discovered the course and skipped its content.
    expect(harness.source.fetchCalls).toHaveLength(1);
  });

  it('has no write path from sync to a tracking decision', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];
    harness.tracking.tracked.add('course-c1');

    await runSync(harness);
    await runSync(harness);

    // Same reasoning as classification overrides: the guarantee is structural,
    // not a convention that a future refactor could quietly break.
    expect(harness.tracking.writes).toHaveLength(0);
  });
});

describe('scope is stored beside relevance', () => {
  it('records what the coursework targeted, not only what it means for the student', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({
        assignments: [
          assignmentRecord({ sourceItemId: 'w1', title: 'Assignment 3 - Section G' }),
          assignmentRecord({ sourceItemId: 'w2', title: 'Assignment 3' }),
          assignmentRecord({ sourceItemId: 'w3', title: 'Assignment 3 - Section A' }),
        ],
      }),
    );
    trackAll(harness);

    await runSync(harness);

    const byId = new Map(harness.classifications.written.map((row) => [row.assignmentId, row]));

    expect(byId.get('assignment-w1')).toMatchObject({
      relevance: 'RELEVANT',
      scopeType: 'SPECIFIC_SECTIONS',
      scopeSections: ['g'],
    });
    // The unlabelled one is unrestricted, and that is a fact about the
    // assignment rather than a hedge about the student.
    expect(byId.get('assignment-w2')).toMatchObject({
      relevance: 'RELEVANT',
      scopeType: 'ALL_SECTIONS',
      scopeSections: [],
      scopeRule: 'NO_SECTION_RESTRICTION_FOUND',
    });
    expect(byId.get('assignment-w3')).toMatchObject({
      relevance: 'NOT_RELEVANT',
      scopeType: 'SPECIFIC_SECTIONS',
      scopeSections: ['a'],
    });
  });
});

describe('rule set changes', () => {
  it('escalates an incremental run to a full pass when stored verdicts are stale', async () => {
    // An incremental pass only revisits coursework Google changed recently, so
    // without this a rule fix would leave every untouched assignment on its old
    // verdict forever.
    const classifications = new FakeClassificationRepository();
    classifications.staleRuleset = true;

    const harness = buildService({ classifications });
    harness.source.courses = [courseRecord()];
    harness.courses.stored.set('c1', {
      id: 'course-c1',
      sourceCourseId: 'c1',
      name: 'Data Structures',
      section: null,
      courseworkWatermark: new Date('2026-02-01T00:00:00Z'),
      lifecycleStatus: 'ACTIVE',
    });

    trackAll(harness);
    await runSync(harness, { ...RUN, mode: 'INCREMENTAL' });

    expect(harness.syncRuns.runFor('user-1')?.mode).toBe('FULL');
    expect(harness.source.fetchCalls[0]?.updatedSince).toBeNull();
  });

  it('stays incremental when every stored verdict matches the current rule set', async () => {
    const classifications = new FakeClassificationRepository();
    classifications.staleRuleset = false;

    const harness = buildService({ classifications });
    harness.source.courses = [courseRecord()];
    harness.courses.stored.set('c1', {
      id: 'course-c1',
      sourceCourseId: 'c1',
      name: 'Data Structures',
      section: null,
      courseworkWatermark: new Date('2026-02-01T00:00:00Z'),
      lifecycleStatus: 'ACTIVE',
    });

    trackAll(harness);
    await runSync(harness, { ...RUN, mode: 'INCREMENTAL' });

    expect(harness.syncRuns.runFor('user-1')?.mode).toBe('INCREMENTAL');
    expect(harness.source.fetchCalls[0]?.updatedSince).not.toBeNull();
  });
});

describe('concurrency', () => {
  it('refuses a second run while one holds the lease', async () => {
    const harness = buildService();
    await harness.service.start(RUN);

    await expect(harness.service.start(RUN)).rejects.toMatchObject({
      code: 'SYNC_ALREADY_RUNNING',
    });
  });

  it('rejects before spending a single API call', async () => {
    const harness = buildService();
    await harness.service.start(RUN);

    await expect(harness.service.start(RUN)).rejects.toThrow();
    expect(harness.source.fetchCalls).toHaveLength(0);
  });

  it('refuses a second run while one is queued for continuation', async () => {
    // A handed-over run is not idle. Treating QUEUED as "free" would let a
    // second trigger start a parallel run over the same courses.
    const harness = buildService({ invocationBudgetMs: 4_000, initialUnitEstimateMs: 3_000 });
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];
    trackAll(harness);

    const lease = await harness.service.start(RUN);
    const outcome = await harness.service.work(lease, RUN);
    expect(outcome.kind).toBe('HANDED_OFF');

    await expect(harness.service.start(RUN)).rejects.toMatchObject({
      code: 'SYNC_ALREADY_RUNNING',
    });
  });

  it('processes one course at a time rather than fanning out', async () => {
    // The old model ran courses concurrently inside a single request, which is
    // what made a run all-or-nothing: there was no point at which some courses
    // were done and the rest were resumable. One at a time is slower per
    // invocation and is what makes progress durable between them.
    const source = new FakeSourceAdapter();
    let inFlight = 0;
    let peak = 0;

    source.fetchCourseContent = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return emptyCourseContent();
    };

    const harness = buildService({ source });
    source.courses = Array.from({ length: 6 }, (_, index) =>
      courseRecord({ sourceCourseId: `c${String(index)}` }),
    );
    trackAll(harness);

    await runSync(harness);

    expect(peak).toBe(1);
    expect(harness.syncRuns.resultsOf('run-1')).toHaveLength(6);
  });
});

describe('missing academic profile', () => {
  it('still synchronises source data but writes no classifications', async () => {
    const profiles = new FakeAcademicProfileRepository();
    profiles.profile = null;

    const harness = buildService({ profiles });
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ assignments: [assignmentRecord()] }),
    );

    trackAll(harness);
    const outcome = await runSync(harness);

    expect(outcome.counts.assignmentsCreated).toBe(1);
    // Classifying without knowing the section would mean inventing every
    // verdict. Unclassified reads back as UNCERTAIN, which is honest.
    expect(harness.classifications.written).toHaveLength(0);
    expect(outcome.issues.some((issue) => issue.code === 'NO_ACADEMIC_PROFILE')).toBe(true);
  });
});

describe('source user id discovery', () => {
  it('reports a Classroom user id observed during the fetch', async () => {
    const harness = buildService();
    harness.source.courses = [courseRecord()];
    harness.source.contentByCourse.set(
      'c1',
      emptyCourseContent({ observedSourceUserId: 'google-user-99' }),
    );

    trackAll(harness);

    const observed: string[] = [];
    const input = {
      ...RUN,
      onSourceUserIdObserved: (id: string) => {
        observed.push(id);
        return Promise.resolve();
      },
    };
    const lease = await harness.service.start(input);
    await harness.service.work(lease, input);

    // Learning it here avoids a broader OAuth scope just to enable the
    // source-targeting rule.
    expect(observed).toEqual(['google-user-99']);
  });
});
