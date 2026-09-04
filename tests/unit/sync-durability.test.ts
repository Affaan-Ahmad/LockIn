import { describe, expect, it } from 'vitest';

import { ClassroomSyncService } from '@/application/services/classroom-sync.service';
import { CourseDiscoveryService } from '@/application/services/course-discovery.service';
import { SyncWorker, type ContinuationTrigger } from '@/application/services/sync-worker';
import { createRelevanceClassifier } from '@/domain/classification/registry';
import { ExecutionDeadline, deriveBudget } from '@/domain/sync/deadline';
import { fixedClock, type Clock } from '@/shared/clock';
import { AuthorizationExpiredError, ConfigError } from '@/shared/errors';
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
 * The properties that make synchronisation survive losing its process.
 *
 * Every test here describes a way the old design lost work: the request was
 * killed, the worker was replaced, one course failed and took the run with it.
 * They are written against the real service and the real state machine -- only
 * the storage and the network are faked -- because these are exactly the
 * behaviours that cannot be verified by reading the code.
 */

/** Advances on demand, so a deadline can be reached without waiting for one. */
function movableClock(startIso: string): Clock & { advance: (ms: number) => void } {
  let now = new Date(startIso).getTime();
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

interface HarnessOptions {
  readonly courseCount?: number;
  readonly invocationBudgetMs?: number;
  readonly initialUnitEstimateMs?: number;
  readonly clock?: Clock;
  readonly failCourses?: readonly string[];
}

function harness(options: HarnessOptions = {}) {
  const source = new FakeSourceAdapter();
  const courses = new FakeCourseRepository();
  const assignments = new FakeAssignmentRepository();
  const submissions = new FakeSubmissionRepository();
  const classifications = new FakeClassificationRepository();
  const tracking = new FakeCourseTrackingRepository(courses);
  const profiles = new FakeAcademicProfileRepository();
  const syncRuns = new FakeSyncRunRepository();
  const clock = options.clock ?? fixedClock('2026-03-01T12:00:00Z');

  source.courses = Array.from({ length: options.courseCount ?? 3 }, (_, index) =>
    courseRecord({ sourceCourseId: `c${String(index)}`, name: `Course ${String(index)}` }),
  );
  for (const id of options.failCourses ?? []) source.failCourses.add(id);

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
      invocationBudgetMs: options.invocationBudgetMs ?? 3_600_000,
      checkoutReserveMs: 1_000,
      initialUnitEstimateMs: options.initialUnitEstimateMs ?? 1,
      maxCourseAttempts: 3,
    },
    scheduleHeartbeat: () => () => undefined,
  });

  for (const course of source.courses) tracking.tracked.add(`course-${course.sourceCourseId}`);

  return { service, source, courses, assignments, syncRuns, tracking, clock };
}

const RUN = { userId: 'user-1', trigger: 'MANUAL', mode: 'FULL' } as const;

// ---------------------------------------------------------------------------
// 1. A request that ends early leaves resumable progress
// ---------------------------------------------------------------------------

describe('an invocation that stops before the work is done', () => {
  it('hands the run over instead of being killed holding it', async () => {
    // The budget allows one course; the estimate says another will not fit.
    const clock = movableClock('2026-03-01T12:00:00Z');
    const h = harness({ courseCount: 3, clock, invocationBudgetMs: 10_000, initialUnitEstimateMs: 4_000 });

    h.source.fetchCourseContent = () => {
      clock.advance(4_000);
      return Promise.resolve(emptyCourseContent());
    };

    const lease = await h.service.start(RUN);
    const outcome = await h.service.work(lease, RUN);

    expect(outcome.kind).toBe('HANDED_OFF');
    // QUEUED, not RUNNING and not abandoned: the next worker's entry condition.
    expect(h.syncRuns.runs.get(outcome.syncRunId)?.status).toBe('QUEUED');
    expect(h.syncRuns.runs.get(outcome.syncRunId)?.owner).toBeNull();
  });

  it('keeps every course it finished, and does not redo them', async () => {
    const clock = movableClock('2026-03-01T12:00:00Z');
    const h = harness({ courseCount: 3, clock, invocationBudgetMs: 10_000, initialUnitEstimateMs: 4_000 });

    const fetched: string[] = [];
    h.source.fetchCourseContent = (_ctx, course) => {
      fetched.push(course.sourceCourseId);
      clock.advance(4_000);
      return Promise.resolve(emptyCourseContent());
    };

    const lease = await h.service.start(RUN);
    await h.service.work(lease, RUN);
    const afterFirst = [...fetched];
    expect(afterFirst.length).toBeGreaterThan(0);
    expect(afterFirst.length).toBeLessThan(3);

    // A fresh worker picks up exactly where the last one stopped.
    const resumed = await h.service.resume('user-1');
    expect(resumed).not.toBeNull();
    await h.service.work(resumed!, RUN);

    // No course is fetched twice: the completed work items were skipped.
    expect(new Set(fetched).size).toBe(fetched.length);
  });

  it('reaches a terminal status once the continuations finish the queue', async () => {
    const clock = movableClock('2026-03-01T12:00:00Z');
    const h = harness({ courseCount: 4, clock, invocationBudgetMs: 10_000, initialUnitEstimateMs: 4_000 });

    h.source.fetchCourseContent = () => {
      clock.advance(4_000);
      return Promise.resolve(emptyCourseContent());
    };

    const lease = await h.service.start(RUN);
    let outcome = await h.service.work(lease, RUN);
    let guard = 0;
    while (outcome.kind === 'HANDED_OFF' && guard < 10) {
      const next = await h.service.resume('user-1');
      if (next === null) break;
      outcome = await h.service.work(next, RUN);
      guard += 1;
    }

    expect(outcome).toMatchObject({ kind: 'COMPLETED', status: 'SUCCESS' });
    expect(h.syncRuns.resultsOf(outcome.syncRunId)).toHaveLength(4);
  });

  it('does not skip coursework when a course is interrupted mid-pagination', async () => {
    // The watermark is advanced only after every write for that course
    // succeeded. So an interrupted course re-reads the same window on retry
    // rather than resuming past coursework it never persisted. Re-reading is
    // cheap and idempotent; skipping would lose an assignment silently.
    const h = harness({ courseCount: 1 });
    let attempt = 0;

    h.source.fetchCourseContent = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('connection reset mid-page'));
      return Promise.resolve(emptyCourseContent());
    };

    const lease = await h.service.start(RUN);
    await h.service.work(lease, RUN);

    expect(h.courses.watermarks.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. Idempotency, and dying between persistence and bookkeeping
// ---------------------------------------------------------------------------

describe('running the same work twice', () => {
  it('adds no duplicate work items when a plan is rebuilt', async () => {
    const h = harness({ courseCount: 3 });
    const lease = await h.service.start(RUN);

    const first = await h.syncRuns.enqueueCourses(lease.syncRunId, lease.owner, [
      { sourceCourseId: 'c0', courseId: 'course-c0', courseName: 'Course 0' },
    ]);
    const second = await h.syncRuns.enqueueCourses(lease.syncRunId, lease.owner, [
      { sourceCourseId: 'c0', courseId: 'course-c0', courseName: 'Course 0' },
    ]);

    expect(first).toBe(1);
    // The unique constraint on (sync_run_id, source_course_id) is what makes
    // re-planning after a resume free rather than destructive.
    expect(second).toBe(0);
    expect(h.syncRuns.runs.get(lease.syncRunId)?.courses).toHaveLength(1);
  });

  it('does not create duplicate assignments when a course is processed twice', async () => {
    const h = harness({ courseCount: 1 });
    h.source.contentByCourse.set(
      'c0',
      emptyCourseContent({ assignments: [assignmentRecord({ sourceItemId: 'a1' })] }),
    );

    await runToCompletion(h);
    const afterFirst = h.assignments.rows.size;

    // A second full run over identical source data.
    await runToCompletion(h);

    expect(h.assignments.rows.size).toBe(afterFirst);
  });

  it('is safe when a worker dies after persisting but before recording success', async () => {
    // The dangerous window: the coursework is written, the work item is not yet
    // marked done. Recovery re-runs that course, and the upserts absorb it.
    const h = harness({ courseCount: 1 });
    h.source.contentByCourse.set(
      'c0',
      emptyCourseContent({ assignments: [assignmentRecord({ sourceItemId: 'a1' })] }),
    );
    const lease = await h.service.start(RUN);

    await h.service.work(lease, RUN);
    const storedAfterRun = h.assignments.rows.size;
    expect(storedAfterRun).toBe(1);

    // Force the item back to PENDING, as reclaim does for a course left RUNNING.
    const run = h.syncRuns.runs.get(lease.syncRunId);
    run!.status = 'QUEUED';
    run!.owner = null;
    run!.finalStatus = null;
    run!.courses[0]!.status = 'PENDING';

    const resumed = await h.service.resume('user-1');
    const outcome = await h.service.work(resumed!, RUN);

    expect(outcome).toMatchObject({ kind: 'COMPLETED', status: 'SUCCESS' });
    expect(h.assignments.rows.size).toBe(storedAfterRun);
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. Partial failure
// ---------------------------------------------------------------------------

describe('when some courses fail', () => {
  it('keeps the successful ones and reports PARTIAL, never SUCCESS', async () => {
    const h = harness({ courseCount: 3, failCourses: ['c1'] });

    const result = await runToCompletion(h);

    expect(result.status).toBe('PARTIAL_SUCCESS');
    const results = h.syncRuns.resultsOf(result.syncRunId);
    expect(results.filter((r) => r.status === 'SUCCESS')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'FAILED')).toHaveLength(1);
  });

  it('reports FAILED, not SUCCESS, when every course fails', async () => {
    const h = harness({ courseCount: 3, failCourses: ['c0', 'c1', 'c2'] });

    const result = await runToCompletion(h);

    expect(result.status).toBe('FAILED');
  });

  it('cannot be finalised while any course is still queued', async () => {
    // The database derives the status from the queue and refuses early. This is
    // the structural reason a partial run cannot be recorded as a complete one.
    const h = harness({ courseCount: 2 });
    const lease = await h.service.start(RUN);
    await h.syncRuns.enqueueCourses(lease.syncRunId, lease.owner, [
      { sourceCourseId: 'c0', courseId: 'course-c0', courseName: 'Course 0' },
    ]);

    await expect(h.syncRuns.finalize(lease.syncRunId, lease.owner)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6 & 7. Lease handover and fencing
// ---------------------------------------------------------------------------

describe('lease ownership', () => {
  it('lets another worker resume once the lease is released', async () => {
    const h = harness({ courseCount: 2 });
    const lease = await h.service.start(RUN);
    await h.syncRuns.releaseLease(lease.syncRunId, lease.owner);

    const second = await h.service.resume('user-1');

    expect(second).not.toBeNull();
    expect(second?.owner).not.toBe(lease.owner);
    expect(second?.resumeAttempts).toBe(1);
  });

  it('refuses a stale worker trying to release a lease it no longer holds', async () => {
    const h = harness({ courseCount: 2 });
    const lease = await h.service.start(RUN);

    h.syncRuns.stealLease(lease.syncRunId);

    // The classic fencing failure: an old worker comes back from a stall and
    // hands away a run that now belongs to somebody else.
    await expect(h.syncRuns.releaseLease(lease.syncRunId, lease.owner)).resolves.toBe(false);
  });

  it('refuses every write from a worker whose lease was taken', async () => {
    const h = harness({ courseCount: 2 });
    const lease = await h.service.start(RUN);
    h.syncRuns.stealLease(lease.syncRunId);

    await expect(h.syncRuns.renewLease(lease.syncRunId, lease.owner, 90)).resolves.toBe(false);
    await expect(h.syncRuns.claimNextCourse(lease.syncRunId, lease.owner)).resolves.toBeNull();
    await expect(h.syncRuns.finalize(lease.syncRunId, lease.owner)).resolves.toBeNull();
  });

  it('stops the slice rather than writing, when the lease moved on mid-run', async () => {
    const h = harness({ courseCount: 2 });
    const lease = await h.service.start(RUN);

    h.syncRuns.fenceEverything = true;
    const outcome = await h.service.work(lease, RUN);

    expect(outcome.kind).toBe('FENCED');
  });
});

// ---------------------------------------------------------------------------
// 8 & 9 & 10. Credential faults stay distinct
// ---------------------------------------------------------------------------

describe('credential faults', () => {
  it('fails the whole run rather than every course, when the grant is revoked', async () => {
    // A dead credential fails every course identically. Letting it be recorded
    // course by course would waste a dozen Google calls and bury the real cause
    // under a pile of identical errors.
    const h = harness({ courseCount: 3 });
    h.source.fetchCourseContent = () =>
      Promise.reject(new AuthorizationExpiredError('grant revoked'));

    const result = await runToCompletion(h);

    expect(result.status).toBe('FAILED');
    expect(h.source.fetchCalls.length).toBeLessThanOrEqual(1);
    expect(h.syncRuns.issues.some((issue) => issue.code === 'AUTHORIZATION_EXPIRED')).toBe(true);
  });

  it('fails the whole run on a configuration fault, and does not retry course by course', async () => {
    // CREDENTIAL_DECRYPTION_FAILED arrives as a ConfigError. It is an operator
    // problem: retrying it against every course changes nothing and hides it.
    const h = harness({ courseCount: 3 });
    h.source.fetchCourseContent = () =>
      Promise.reject(new ConfigError('Stored Google credentials could not be decrypted'));

    const result = await runToCompletion(h);

    expect(result.status).toBe('FAILED');
    expect(h.syncRuns.issues.some((issue) => issue.code === 'CONFIG_ERROR')).toBe(true);
    expect(h.source.fetchCalls.length).toBeLessThanOrEqual(1);
  });

  it('treats an ordinary course error as a course failure, not a run failure', async () => {
    const h = harness({ courseCount: 3, failCourses: ['c0'] });

    const result = await runToCompletion(h);

    // The distinction that keeps one bad course from discarding the others.
    expect(result.status).toBe('PARTIAL_SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// 12. The internal deadline
// ---------------------------------------------------------------------------

describe('the execution deadline', () => {
  it('refuses a unit that would not fit inside the remaining budget', () => {
    const clock = movableClock('2026-03-01T12:00:00Z');
    const deadline = new ExecutionDeadline(clock, {
      budgetMs: 10_000,
      reserveMs: 2_000,
      initialUnitEstimateMs: 5_000,
    });

    expect(deadline.shouldStartUnit().canStartAnotherUnit).toBe(true);
    clock.advance(4_000);
    // 6s left, 2s reserved, a 5s unit does not fit in the remaining 4s.
    expect(deadline.shouldStartUnit()).toMatchObject({
      canStartAnotherUnit: false,
      reason: 'UNIT_WOULD_OVERRUN',
    });
  });

  it('reports an exhausted budget separately from a unit that will not fit', () => {
    const clock = movableClock('2026-03-01T12:00:00Z');
    const deadline = new ExecutionDeadline(clock, {
      budgetMs: 10_000,
      reserveMs: 2_000,
      initialUnitEstimateMs: 100,
    });

    clock.advance(9_000);
    expect(deadline.shouldStartUnit()).toMatchObject({
      canStartAnotherUnit: false,
      reason: 'BUDGET_EXHAUSTED',
    });
  });

  it('grows its estimate to the worst unit seen, never averages it down', () => {
    // Averaging would let one fast course license starting a slow one, and
    // being wrong in that direction means being killed by the platform.
    const deadline = new ExecutionDeadline(fixedClock('2026-03-01T12:00:00Z'), {
      budgetMs: 60_000,
      reserveMs: 5_000,
      initialUnitEstimateMs: 1_000,
    });

    deadline.recordUnit(9_000);
    deadline.recordUnit(1_000);

    expect(deadline.currentUnitEstimateMs).toBe(9_000);
  });

  it('keeps a real margin under the platform limit at every plan size', () => {
    for (const platformMs of [60_000, 300_000, 800_000]) {
      const { budgetMs, reserveMs } = deriveBudget(platformMs);
      expect(budgetMs).toBeLessThanOrEqual(platformMs - 10_000);
      expect(reserveMs).toBeGreaterThan(0);
      expect(reserveMs).toBeLessThan(budgetMs);
    }
  });
});

// ---------------------------------------------------------------------------
// The continuation chain
// ---------------------------------------------------------------------------

describe('continuation', () => {
  it('asks for a successor when it hands over, and not when it finishes', async () => {
    const clock = movableClock('2026-03-01T12:00:00Z');
    const h = harness({ courseCount: 3, clock, invocationBudgetMs: 10_000, initialUnitEstimateMs: 4_000 });
    h.source.fetchCourseContent = () => {
      clock.advance(4_000);
      return Promise.resolve(emptyCourseContent());
    };

    const requests: string[] = [];
    const continuation: ContinuationTrigger = {
      request: (userId) => {
        requests.push(userId);
        return Promise.resolve(true);
      },
    };
    const worker = new SyncWorker({ sync: h.service, continuation, logger: silentLogger });

    const lease = await h.service.start(RUN);
    await worker.runSlice(lease, RUN);

    expect(requests).toEqual(['user-1']);
  });

  it('leaves the run resumable when the continuation request fails', async () => {
    // The chain is an optimisation. Losing it must cost latency, not work.
    const clock = movableClock('2026-03-01T12:00:00Z');
    const h = harness({ courseCount: 3, clock, invocationBudgetMs: 10_000, initialUnitEstimateMs: 4_000 });
    h.source.fetchCourseContent = () => {
      clock.advance(4_000);
      return Promise.resolve(emptyCourseContent());
    };

    const continuation: ContinuationTrigger = {
      request: () => Promise.reject(new Error('successor unreachable')),
    };
    const worker = new SyncWorker({ sync: h.service, continuation, logger: silentLogger });

    const lease = await h.service.start(RUN);
    const outcome = await worker.runSlice(lease, RUN);

    expect(outcome.kind).toBe('HANDED_OFF');
    expect(h.syncRuns.runs.get(lease.syncRunId)?.status).toBe('QUEUED');
    // And the recovery sweep can find it.
    await expect(h.syncRuns.findResumableUserIds()).resolves.toContain('user-1');
  });

  it('answers null rather than starting a second worker on a finished run', async () => {
    const h = harness({ courseCount: 1 });
    const continuation: ContinuationTrigger = { request: () => Promise.resolve(true) };
    const worker = new SyncWorker({ sync: h.service, continuation, logger: silentLogger });

    await runToCompletion(h);

    await expect(worker.resumeAndRun('user-1', RUN)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------

async function runToCompletion(
  h: ReturnType<typeof harness>,
): Promise<{ syncRunId: string; status: string }> {
  const lease = await h.service.start(RUN);
  let outcome = await h.service.work(lease, RUN);
  let guard = 0;

  while (outcome.kind === 'HANDED_OFF' && guard < 20) {
    const next = await h.service.resume(RUN.userId);
    if (next === null) break;
    outcome = await h.service.work(next, RUN);
    guard += 1;
  }

  return {
    syncRunId: outcome.syncRunId,
    status: h.syncRuns.runs.get(outcome.syncRunId)?.status ?? 'UNKNOWN',
  };
}
