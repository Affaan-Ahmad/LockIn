import type { StudentRelevance } from '@/domain/classification/relevance';
import type { TrackingDecision } from '@/domain/course/tracking';

import type { Deadline } from './deadline';
import { isVisibleLifecycle, type LifecycleStatus, type SourceState } from './lifecycle';

/**
 * What belongs in the deadline feed.
 *
 * Written as a pure predicate here, and mirrored by the SQL in
 * `app_upcoming_assignments`. Two implementations of one rule is a real risk, so
 * the rule is stated once in prose, tested here in isolation, and tested again
 * against the database in the integration suite. Keeping it only in SQL would
 * make it untestable without Postgres; keeping it only in TypeScript would mean
 * filtering thousands of rows in the application.
 */

export type FeedExclusionReason =
  | 'COURSE_NOT_TRACKED'
  | 'NO_DUE_DATE'
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

export type FeedEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: FeedExclusionReason };

const SUBMITTED_STATES = new Set(['TURNED_IN', 'RETURNED']);

/**
 * Order matters only for which reason is reported, not for the outcome. It is
 * arranged cheapest-and-most-decisive first so the reason a student sees is the
 * most useful one: "you are not tracking this subject" beats "it has no due
 * date" when both are true.
 */
export function evaluateFeedEligibility(
  candidate: FeedCandidate,
  options: FeedOptions = {},
): FeedEligibility {
  const includeUncertain = options.includeUncertain ?? true;
  const includeSubmitted = options.includeSubmitted ?? false;

  if (candidate.tracking !== 'TRACKED') {
    return { eligible: false, reason: 'COURSE_NOT_TRACKED' };
  }

  if (candidate.sourceState !== 'PUBLISHED') {
    return { eligible: false, reason: 'NOT_PUBLISHED' };
  }

  if (!isVisibleLifecycle(candidate.lifecycleStatus)) {
    return { eligible: false, reason: 'LIFECYCLE_HIDDEN' };
  }

  // The application is a deadline tracker. Coursework Google gave no due date
  // for is kept -- it is still the student's work -- but it has no place in a
  // list ordered by when things are due, and inventing a date to give it one
  // would be manufacturing the exact data the feed exists to report.
  if (!hasDeadline(candidate.deadline)) {
    return { eligible: false, reason: 'NO_DUE_DATE' };
  }

  if (candidate.relevance === 'NOT_RELEVANT') {
    return { eligible: false, reason: 'NOT_RELEVANT_TO_STUDENT' };
  }

  if (candidate.relevance === 'UNCERTAIN' && !includeUncertain) {
    return { eligible: false, reason: 'NOT_RELEVANT_TO_STUDENT' };
  }

  if (
    !includeSubmitted &&
    candidate.submissionState !== null &&
    SUBMITTED_STATES.has(candidate.submissionState)
  ) {
    return { eligible: false, reason: 'ALREADY_SUBMITTED' };
  }

  return { eligible: true };
}

/**
 * A DATE_ONLY deadline counts: the student was given a day, just not a time.
 * Only NONE is absent.
 */
export function hasDeadline(deadline: Deadline): boolean {
  return deadline.precision !== 'NONE';
}

/**
 * The companion query: coursework worth keeping that has no deadline.
 *
 * Same tracking, publication and relevance filters, inverted only on the due
 * date. This is what makes "No Due Date" a first-class backend query rather
 * than a frontend filter over a feed that should never have contained it.
 */
export function isUndatedCandidate(candidate: FeedCandidate): boolean {
  if (candidate.tracking !== 'TRACKED') return false;
  if (candidate.sourceState !== 'PUBLISHED') return false;
  if (!isVisibleLifecycle(candidate.lifecycleStatus)) return false;
  if (hasDeadline(candidate.deadline)) return false;
  return candidate.relevance !== 'NOT_RELEVANT';
}
