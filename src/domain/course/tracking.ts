/**
 * Course tracking: which subjects the student actually wants followed.
 *
 * A Google Classroom account accumulates courses. Last semester's Programming
 * Fundamentals is still ACTIVE, still enrolled, still full of coursework with
 * no due dates. Google's course state says nothing about whether the student
 * wants it in their deadline feed today, so the application must not infer it.
 *
 * Tracking is therefore modelled the same way manual classification overrides
 * are: a user decision, in its own table, that the synchronisation pipeline can
 * read but has no write path to. Sync discovers courses; it never decides which
 * ones matter.
 */

export type TrackingDecision = 'TRACKED' | 'NOT_TRACKED';

/**
 * The default for a newly discovered course.
 *
 * NOT_TRACKED, deliberately. Opting in is one tap; the alternative is a first
 * sync that pulls thousands of assignments from four years of dead courses and
 * a deadline feed the student has to dig through before they trust it.
 */
export const DEFAULT_TRACKING: TrackingDecision = 'NOT_TRACKED';

export interface CourseTracking {
  readonly courseId: string;
  readonly decision: TrackingDecision;
  /** When the student first made a decision about this course. */
  readonly selectedAt: Date;
  readonly updatedAt: Date;
}

/** A discovered course plus what the student decided about it. */
export interface DiscoveredCourse {
  readonly courseId: string;
  readonly sourceCourseId: string;
  readonly name: string;
  readonly section: string | null;
  readonly courseState: string | null;
  readonly decision: TrackingDecision;
  /** Null when the student has not chosen yet -- distinct from having declined. */
  readonly decidedAt: Date | null;
  readonly lastSyncedAt: Date;
}

export function isTracked(decision: TrackingDecision): boolean {
  return decision === 'TRACKED';
}

/**
 * Google archiving a course does not untrack it.
 *
 * The student's decision outlives the source's state, and their coursework
 * history is preserved either way. Silently flipping tracking off would drop
 * the course out of every query that reads through the tracking table, which
 * looks exactly like data loss from the outside.
 */
export function reconcileWithSourceState(
  decision: TrackingDecision,
  _sourceCourseState: string | null,
): TrackingDecision {
  return decision;
}
