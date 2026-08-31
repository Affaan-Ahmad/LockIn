import type { StudentRelevance } from '@/domain/classification/relevance';
import type { TrackingDecision } from '@/domain/course/tracking';

import { deadlineInTimeZone, type Deadline } from './deadline';
import { isVisibleLifecycle, type LifecycleStatus, type SourceState } from './lifecycle';

/**
 * Which list a piece of coursework belongs in.
 *
 * Two separate questions, deliberately not merged:
 *
 *   1. Should this be visible at all?   -> evaluateVisibility
 *   2. Which tab does it belong in?     -> deadlineBucket
 *
 * The rules live here as pure functions and are mirrored by SQL in
 * `app_upcoming_assignments` / `app_overdue_assignments` / `app_undated_assignments`.
 * Two implementations of one rule is a real risk, so the rule is stated once in
 * prose, tested here in isolation, and tested again against Postgres in the
 * integration suite.
 */

export type DeadlineBucket =
  /** Has a deadline that has not passed. */
  | 'UPCOMING'
  /** Has a deadline that has passed. */
  | 'OVERDUE'
  /** Google gave no due date at all. */
  | 'UNDATED';

export type FeedExclusionReason =
  | 'COURSE_NOT_TRACKED'
  | 'NOT_RELEVANT_TO_STUDENT'
  | 'NOT_PUBLISHED'
  | 'LIFECYCLE_HIDDEN'
  | 'ALREADY_SUBMITTED';

export interface FeedCandidate {
  readonly tracking: TrackingDecision;
  readonly deadline: Deadline;
  readonly relevance: StudentRelevance;
  readonly lifecycleStatus: LifecycleStatus;
  readonly sourceState: SourceState;
  readonly submissionState: string | null;
}

export interface FeedOptions {
  /** UNCERTAIN is included by default: review items must stay visible. */
  readonly includeUncertain?: boolean;
  readonly includeSubmitted?: boolean;
}

export type Visibility =
  | { readonly visible: true }
  | { readonly visible: false; readonly reason: FeedExclusionReason };

const SUBMITTED_STATES = new Set(['TURNED_IN', 'RETURNED']);

/**
 * Whether the student should see this coursework anywhere.
 *
 * Note what is absent: having no due date is not a reason to hide something.
 * That decides the bucket, not the visibility, which is what keeps undated work
 * reachable instead of silently dropped.
 */
export function evaluateVisibility(
  candidate: FeedCandidate,
  options: FeedOptions = {},
): Visibility {
  const includeUncertain = options.includeUncertain ?? true;
  const includeSubmitted = options.includeSubmitted ?? false;

  if (candidate.tracking !== 'TRACKED') {
    return { visible: false, reason: 'COURSE_NOT_TRACKED' };
  }
  if (candidate.sourceState !== 'PUBLISHED') {
    return { visible: false, reason: 'NOT_PUBLISHED' };
  }
  if (!isVisibleLifecycle(candidate.lifecycleStatus)) {
    return { visible: false, reason: 'LIFECYCLE_HIDDEN' };
  }
  if (candidate.relevance === 'NOT_RELEVANT') {
    return { visible: false, reason: 'NOT_RELEVANT_TO_STUDENT' };
  }
  if (candidate.relevance === 'UNCERTAIN' && !includeUncertain) {
    return { visible: false, reason: 'NOT_RELEVANT_TO_STUDENT' };
  }
  if (
    !includeSubmitted &&
    candidate.submissionState !== null &&
    SUBMITTED_STATES.has(candidate.submissionState)
  ) {
    return { visible: false, reason: 'ALREADY_SUBMITTED' };
  }

  return { visible: true };
}

/** Which of the three tabs this belongs in. Says nothing about visibility. */
export function deadlineBucket(
  deadline: Deadline,
  now: Date,
  timeZone: string,
): DeadlineBucket {
  if (deadline.precision === 'NONE') return 'UNDATED';
  return isPastDue(deadline, now, timeZone) ? 'OVERDUE' : 'UPCOMING';
}

/**
 * Whether a deadline has actually passed.
 *
 * The DATE_ONLY branch is the whole reason this is not a one-line comparison
 * against the sort key. A date with no time sorts at 00:00 UTC, so comparing
 * against that marks work overdue the moment the UTC day begins -- for a student
 * in UTC+5, five hours before their day has started and a full day before the
 * deadline they were actually given.
 *
 * Work due "on the 14th" is late on the 15th, in the student's own timezone.
 */
export function isPastDue(deadline: Deadline, now: Date, timeZone: string): boolean {
  if (deadline.precision === 'EXACT' && deadline.dueAt !== null) {
    return deadline.dueAt.getTime() < now.getTime();
  }

  if (deadline.precision === 'DATE_ONLY' && deadline.dueDate !== null) {
    const today = localCalendarDate(now, timeZone);
    const due = deadline.dueDate;
    if (due.year !== today.year) return due.year < today.year;
    if (due.month !== today.month) return due.month < today.month;
    return due.day < today.day;
  }

  return false;
}

/**
 * Today's date in the student's timezone.
 *
 * Uses Intl rather than offset arithmetic because only Intl knows when a zone
 * changed its rules or crossed a DST boundary.
 */
function localCalendarDate(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Map<string, string>(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type as string, part.value]),
      );

  return {
    year: Number(parts.get('year') ?? '0'),
    month: Number(parts.get('month') ?? '0'),
    day: Number(parts.get('day') ?? '0'),
    };
}

/** Re-exported for callers that render an exact deadline locally. */
export { deadlineInTimeZone };
