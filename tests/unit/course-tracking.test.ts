import { describe, expect, it } from 'vitest';

import { CourseDiscoveryService } from '@/application/services/course-discovery.service';
import type { Deadline } from '@/domain/assignment/deadline';
import { deadlineBucket, evaluateVisibility, isPastDue } from '@/domain/assignment/feed';
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

const FUTURE: Deadline = {
  precision: 'EXACT',
  dueDate: { year: 2026, month: 9, day: 30 },
  dueTime: { hours: 18, minutes: 59, seconds: 0 },
  dueAt: new Date('2026-09-30T18:59:00Z'),
};

const NO_DEADLINE: Deadline = {
  precision: 'NONE',
  dueDate: null,
  dueTime: null,
  dueAt: null,
};

function candidate(overrides: Partial<Parameters<typeof evaluateVisibility>[0]> = {}) {
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

describe('visibility', () => {
  it('shows tracked, relevant coursework', () => {
    expect(evaluateVisibility(candidate())).toEqual({ visible: true });
  });

  it('hides coursework from an untracked course', () => {
    // Last semester's course is still ACTIVE in Classroom and still enrolled.
    // Google's state is not the student's intent.
    expect(evaluateVisibility(candidate({ tracking: 'NOT_TRACKED' }))).toEqual({
      visible: false,
      reason: 'COURSE_NOT_TRACKED',
    });
  });

  it('does NOT hide coursework merely for having no due date', () => {
    // Regression against the earlier model, which treated "no deadline" as a
    // reason to hide. It decides the bucket, not visibility -- otherwise
    // undated work is silently dropped rather than filed.
    expect(evaluateVisibility(candidate({ deadline: NO_DEADLINE }))).toEqual({ visible: true });
  });

  it('hides coursework that targets another section', () => {
    expect(evaluateVisibility(candidate({ relevance: 'NOT_RELEVANT' }))).toEqual({
      visible: false,
      reason: 'NOT_RELEVANT_TO_STUDENT',
    });
  });

  it('shows UNCERTAIN coursework by default', () => {
    expect(evaluateVisibility(candidate({ relevance: 'UNCERTAIN' }))).toEqual({ visible: true });
  });

  it('hides drafts and removed items', () => {
    expect(evaluateVisibility(candidate({ sourceState: 'DRAFT' }))).toMatchObject({
      reason: 'NOT_PUBLISHED',
    });
    expect(evaluateVisibility(candidate({ lifecycleStatus: 'SOURCE_REMOVED' }))).toMatchObject({
      reason: 'LIFECYCLE_HIDDEN',
    });
  });

  it('keeps showing an item that merely went missing from one listing', () => {
    expect(evaluateVisibility(candidate({ lifecycleStatus: 'SOURCE_MISSING' }))).toEqual({
      visible: true,
    });
  });

  it('hides submitted work unless asked for it', () => {
    expect(evaluateVisibility(candidate({ submissionState: 'TURNED_IN' }))).toMatchObject({
      reason: 'ALREADY_SUBMITTED',
    });
    expect(
      evaluateVisibility(candidate({ submissionState: 'TURNED_IN' }), { includeSubmitted: true }),
    ).toEqual({ visible: true });
  });
});

describe('which tab: upcoming, overdue, or undated', () => {
  const KARACHI = 'Asia/Karachi';
  const NOW = new Date('2026-08-31T09:00:00Z');

  it('partitions every deadline into exactly one bucket', () => {
    expect(deadlineBucket(EXACT, NOW, KARACHI)).toBe('OVERDUE');
    expect(deadlineBucket(FUTURE, NOW, KARACHI)).toBe('UPCOMING');
    expect(deadlineBucket(NO_DEADLINE, NOW, KARACHI)).toBe('UNDATED');
    // A date with no time is still a deadline -- it belongs in a dated bucket,
    // never in UNDATED.
    expect(deadlineBucket(DATE_ONLY, NOW, KARACHI)).not.toBe('UNDATED');
  });

  it('does not mark a date-only deadline overdue until that day has ended locally', () => {
    // The bug this guards: due_sort_at puts a date-only item at 00:00 UTC, so a
    // naive comparison calls it overdue at 05:00 local for a student in UTC+5 --
    // five hours before their day begins, and a day before the actual deadline.
    const dueToday = {
      precision: 'DATE_ONLY' as const,
      dueDate: { year: 2026, month: 8, day: 31 },
      dueTime: null,
      dueAt: null,
    };
    // 09:00Z is 14:00 in Karachi on the 31st -- the day is not over.
    expect(isPastDue(dueToday, NOW, KARACHI)).toBe(false);
    expect(deadlineBucket(dueToday, NOW, KARACHI)).toBe('UPCOMING');
  });

  it('marks a date-only deadline overdue once the local day has rolled over', () => {
    const dueYesterday = {
      precision: 'DATE_ONLY' as const,
      dueDate: { year: 2026, month: 8, day: 30 },
      dueTime: null,
      dueAt: null,
    };
    expect(deadlineBucket(dueYesterday, NOW, KARACHI)).toBe('OVERDUE');
  });

  it('respects the student timezone at the day boundary', () => {
    const dueOn31st = {
      precision: 'DATE_ONLY' as const,
      dueDate: { year: 2026, month: 8, day: 31 },
      dueTime: null,
      dueAt: null,
    };
    // 20:00Z on the 31st is already 01:00 on 1 Sept in Karachi -- so the day
    // has ended there, but not in UTC.
    const late = new Date('2026-08-31T20:00:00Z');
    expect(deadlineBucket(dueOn31st, late, KARACHI)).toBe('OVERDUE');
    expect(deadlineBucket(dueOn31st, late, 'UTC')).toBe('UPCOMING');
  });

  it('uses the exact instant when there is one', () => {
    const justPast = {
      precision: 'EXACT' as const,
      dueDate: { year: 2026, month: 8, day: 31 },
      dueTime: { hours: 8, minutes: 59, seconds: 0 },
      dueAt: new Date('2026-08-31T08:59:00Z'),
    };
    expect(deadlineBucket(justPast, NOW, KARACHI)).toBe('OVERDUE');
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
