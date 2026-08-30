import { describe, expect, it } from 'vitest';

import { CourseDiscoveryService } from '@/application/services/course-discovery.service';
import type { Deadline } from '@/domain/assignment/deadline';
import { evaluateFeedEligibility, isUndatedCandidate } from '@/domain/assignment/feed';
import { reconcileWithSourceState } from '@/domain/course/tracking';
import { fixedClock } from '@/shared/clock';
import { silentLogger } from '@/shared/logger';

import {
  courseRecord,
  FakeCourseRepository,
  FakeCourseTrackingRepository,
  FakeSourceAdapter,
} from '../helpers/fakes';

/**
 * Course tracking and deadline-feed eligibility.
 *
 * These are the rules that decide what a student ever sees, so they are tested
 * as pure functions here and again against the real SQL in the integration
 * suite. Both matter: the predicate must be right, and the query must implement
 * the same predicate.
 */

const EXACT: Deadline = {
  precision: 'EXACT',
  dueDate: { year: 2026, month: 3, day: 14 },
  dueTime: { hours: 18, minutes: 59, seconds: 0 },
  dueAt: new Date('2026-03-14T18:59:00Z'),
};

const DATE_ONLY: Deadline = {
  precision: 'DATE_ONLY',
  dueDate: { year: 2026, month: 3, day: 14 },
  dueTime: null,
  dueAt: null,
};

const NO_DEADLINE: Deadline = {
  precision: 'NONE',
  dueDate: null,
  dueTime: null,
  dueAt: null,
};

function candidate(overrides: Partial<Parameters<typeof evaluateFeedEligibility>[0]> = {}) {
  return {
    tracking: 'TRACKED' as const,
    deadline: EXACT,
    relevance: 'RELEVANT' as const,
    lifecycleStatus: 'ACTIVE' as const,
    sourceState: 'PUBLISHED' as const,
    submissionState: null,
    ...overrides,
  };
}

describe('deadline feed eligibility', () => {
  it('includes tracked, dated, relevant coursework', () => {
    expect(evaluateFeedEligibility(candidate())).toEqual({ eligible: true });
  });

  it('excludes coursework from an untracked course', () => {
    // Last semester's Programming Fundamentals is still ACTIVE in Classroom and
    // still enrolled. Google's state is not the student's intent.
    expect(evaluateFeedEligibility(candidate({ tracking: 'NOT_TRACKED' }))).toEqual({
      eligible: false,
      reason: 'COURSE_NOT_TRACKED',
    });
  });

  it('excludes coursework with no due date', () => {
    // Preserved elsewhere, but a deadline feed cannot order what has no
    // deadline, and inventing one is the fabrication this backend refuses.
    expect(evaluateFeedEligibility(candidate({ deadline: NO_DEADLINE }))).toEqual({
      eligible: false,
      reason: 'NO_DUE_DATE',
    });
  });

  it('includes a date-only deadline', () => {
    // The student was given a day, just not a time. That is still a deadline.
    expect(evaluateFeedEligibility(candidate({ deadline: DATE_ONLY }))).toEqual({
      eligible: true,
    });
  });

  it('excludes coursework that targets another section', () => {
    expect(evaluateFeedEligibility(candidate({ relevance: 'NOT_RELEVANT' }))).toEqual({
      eligible: false,
      reason: 'NOT_RELEVANT_TO_STUDENT',
    });
  });

  it('includes UNCERTAIN coursework by default', () => {
    // Review items must stay visible; hiding them defeats the point of having
    // a third value at all.
    expect(evaluateFeedEligibility(candidate({ relevance: 'UNCERTAIN' }))).toEqual({
      eligible: true,
    });
  });

  it('can be asked to leave UNCERTAIN out', () => {
    expect(
      evaluateFeedEligibility(candidate({ relevance: 'UNCERTAIN' }), { includeUncertain: false }),
    ).toEqual({ eligible: false, reason: 'NOT_RELEVANT_TO_STUDENT' });
  });

  it('excludes draft coursework', () => {
    expect(evaluateFeedEligibility(candidate({ sourceState: 'DRAFT' }))).toMatchObject({
      eligible: false,
      reason: 'NOT_PUBLISHED',
    });
  });

  it('keeps showing an item that merely went missing from one listing', () => {
    expect(evaluateFeedEligibility(candidate({ lifecycleStatus: 'SOURCE_MISSING' }))).toEqual({
      eligible: true,
    });
  });

  it('drops an item confirmed removed at source', () => {
    expect(evaluateFeedEligibility(candidate({ lifecycleStatus: 'SOURCE_REMOVED' }))).toMatchObject(
      { eligible: false, reason: 'LIFECYCLE_HIDDEN' },
    );
  });

  it('hides submitted work unless asked for it', () => {
    expect(evaluateFeedEligibility(candidate({ submissionState: 'TURNED_IN' }))).toMatchObject({
      eligible: false,
      reason: 'ALREADY_SUBMITTED',
    });
    expect(
      evaluateFeedEligibility(candidate({ submissionState: 'TURNED_IN' }), {
        includeSubmitted: true,
      }),
    ).toEqual({ eligible: true });
  });

  it('reports the most useful reason when several apply', () => {
    // "You are not tracking this subject" is more actionable than "it has no
    // due date", and both are true here.
    expect(
      evaluateFeedEligibility(
        candidate({ tracking: 'NOT_TRACKED', deadline: NO_DEADLINE, relevance: 'NOT_RELEVANT' }),
      ),
    ).toEqual({ eligible: false, reason: 'COURSE_NOT_TRACKED' });
  });
});

describe('the undated companion query', () => {
  it('accepts exactly what the deadline feed rejects for having no date', () => {
    expect(isUndatedCandidate(candidate({ deadline: NO_DEADLINE }))).toBe(true);
    expect(isUndatedCandidate(candidate({ deadline: EXACT }))).toBe(false);
    expect(isUndatedCandidate(candidate({ deadline: DATE_ONLY }))).toBe(false);
  });

  it('still respects tracking and relevance', () => {
    expect(
      isUndatedCandidate(candidate({ deadline: NO_DEADLINE, tracking: 'NOT_TRACKED' })),
    ).toBe(false);
    expect(
      isUndatedCandidate(candidate({ deadline: NO_DEADLINE, relevance: 'NOT_RELEVANT' })),
    ).toBe(false);
  });

  it('keeps uncertain undated work reachable', () => {
    expect(
      isUndatedCandidate(candidate({ deadline: NO_DEADLINE, relevance: 'UNCERTAIN' })),
    ).toBe(true);
  });

  it('partitions cleanly: nothing is in both lists, nothing falls between them', () => {
    for (const deadline of [EXACT, DATE_ONLY, NO_DEADLINE]) {
      const item = candidate({ deadline });
      const inFeed = evaluateFeedEligibility(item).eligible;
      const inUndated = isUndatedCandidate(item);
      expect(inFeed && inUndated).toBe(false);
      expect(inFeed || inUndated).toBe(true);
    }
  });
});

describe('tracking survives source state', () => {
  it('does not untrack a course Google archived', () => {
    // Flipping tracking off would drop the course out of every tracked query,
    // which is indistinguishable from data loss to the person looking at it.
    expect(reconcileWithSourceState('TRACKED', 'ARCHIVED')).toBe('TRACKED');
    expect(reconcileWithSourceState('TRACKED', null)).toBe('TRACKED');
  });

  it('does not auto-track a course just because Google reports it active', () => {
    expect(reconcileWithSourceState('NOT_TRACKED', 'ACTIVE')).toBe('NOT_TRACKED');
  });
});

describe('course discovery', () => {
  function buildDiscovery() {
    const source = new FakeSourceAdapter();
    const courses = new FakeCourseRepository();
    const tracking = new FakeCourseTrackingRepository(courses);

    const service = new CourseDiscoveryService({
      source,
      courses,
      tracking,
      logger: silentLogger,
      clock: fixedClock('2026-03-01T12:00:00Z'),
    });

    return { service, source, courses, tracking };
  }

  it('stores every course Google returns, tracked or not', () => {
    const harness = buildDiscovery();
    harness.source.courses = [
      courseRecord({ sourceCourseId: 'c1', name: 'Operating Systems' }),
      courseRecord({ sourceCourseId: 'c2', name: 'Old Fall 2025 Class' }),
    ];

    return harness.service.discover('user-1', 'run-1').then(() => {
      // Discovery is the cheap half and must be complete: a student cannot
      // choose a subject they were never shown.
      expect(harness.courses.stored.size).toBe(2);
    });
  });

  it('tracks nothing by default', async () => {
    const harness = buildDiscovery();
    harness.source.courses = [courseRecord({ sourceCourseId: 'c1' })];

    await harness.service.discover('user-1', 'run-1');

    // Opting in is one tap. The alternative is a first sync that pulls four
    // years of dead coursework into the feed.
    expect(await harness.tracking.listTrackedCourseIds()).toEqual(new Set());
  });

  it('records a selection and reports how many were written', async () => {
    const harness = buildDiscovery();
    const updated = await harness.service.setTracking('user-1', [
      { courseId: 'course-c1', decision: 'TRACKED' },
      { courseId: 'course-c2', decision: 'NOT_TRACKED' },
    ]);

    expect(updated).toBe(2);
    expect(await harness.tracking.listTrackedCourseIds()).toEqual(new Set(['course-c1']));
  });

  it('lets a student change their mind', async () => {
    const harness = buildDiscovery();
    await harness.service.setTracking('user-1', [
      { courseId: 'course-c1', decision: 'TRACKED' },
    ]);
    await harness.service.setTracking('user-1', [
      { courseId: 'course-c1', decision: 'NOT_TRACKED' },
    ]);

    expect(await harness.tracking.listTrackedCourseIds()).toEqual(new Set());
  });

  it('rejects an empty selection rather than silently doing nothing', async () => {
    const harness = buildDiscovery();
    await expect(harness.service.setTracking('user-1', [])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
