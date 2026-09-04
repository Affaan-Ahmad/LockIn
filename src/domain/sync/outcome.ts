import type { ListingCompleteness } from '@/domain/assignment/lifecycle';

/**
 * The result algebra for a synchronisation run.
 *
 * "Sync failed" is almost never the truth. A run touches many courses, and one
 * course failing on a 403 while five others succeed is a materially different
 * situation from a revoked token that failed everything. Collapsing both into a
 * single boolean throws away the information a student needs to know whether
 * their list is trustworthy, and the information we need to debug it.
 */

export type SyncTrigger = 'MANUAL' | 'SCHEDULED' | 'ON_DEMAND';
export type SyncMode = 'FULL' | 'INCREMENTAL';

export type SyncRunStatus =
  /** Durable progress exists and no worker owns it. The resumable state. */
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  /** Resumed too many times without completing. Terminal, and a failure. */
  | 'ABANDONED';

/**
 * The two non-terminal states are what the frontend must never round off.
 *
 * `isTerminal` exists so a caller cannot accidentally treat QUEUED or RUNNING
 * as an answer: an unfinished sync is not a successful one, and the polling
 * client needs the difference to be a type-level fact rather than a convention.
 */
const TERMINAL_STATUSES = new Set<SyncRunStatus>([
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'ABANDONED',
]);

export function isTerminalStatus(status: SyncRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Whether a run genuinely refreshed everything it set out to refresh.
 *
 * The single question the freshness model and the UI both need, in one place,
 * so neither can answer it differently. PARTIAL_SUCCESS is deliberately false:
 * some courses were not represented, and recency does not fix incompleteness.
 */
export function isCompleteSuccess(status: SyncRunStatus): boolean {
  return status === 'SUCCESS';
}

export type CourseSyncStatus =
  /** Queued, not yet attempted. This set is the run's checkpoint. */
  | 'PENDING'
  /** Claimed by a worker. Returns to PENDING if that worker dies. */
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED';

export interface SyncCounts {
  readonly coursesProcessed: number;
  readonly coursesSucceeded: number;
  readonly coursesFailed: number;
  readonly assignmentsCreated: number;
  readonly assignmentsUpdated: number;
  readonly assignmentsUnchanged: number;
  readonly assignmentsMarkedMissing: number;
  readonly submissionsUpserted: number;
  readonly classificationsWritten: number;
  readonly relevantCount: number;
  readonly notRelevantCount: number;
  readonly uncertainCount: number;
  readonly itemsRejectedByValidation: number;
}

export const EMPTY_SYNC_COUNTS: SyncCounts = {
  coursesProcessed: 0,
  coursesSucceeded: 0,
  coursesFailed: 0,
  assignmentsCreated: 0,
  assignmentsUpdated: 0,
  assignmentsUnchanged: 0,
  assignmentsMarkedMissing: 0,
  submissionsUpserted: 0,
  classificationsWritten: 0,
  relevantCount: 0,
  notRelevantCount: 0,
  uncertainCount: 0,
  itemsRejectedByValidation: 0,
};

export interface SyncIssue {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly scope: 'RUN' | 'COURSE' | 'ITEM';
  readonly sourceCourseId: string | null;
  readonly sourceItemId: string | null;
}

export interface CourseSyncResult {
  readonly sourceCourseId: string;
  readonly courseName: string;
  readonly status: CourseSyncStatus;
  readonly completeness: ListingCompleteness;
  readonly counts: SyncCounts;
  readonly issues: readonly SyncIssue[];
}

export interface SyncRunOutcome {
  readonly syncRunId: string;
  readonly userId: string;
  readonly trigger: SyncTrigger;
  readonly mode: SyncMode;
  readonly status: SyncRunStatus;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly counts: SyncCounts;
  readonly courses: readonly CourseSyncResult[];
  readonly issues: readonly SyncIssue[];
}

export function addCounts(a: SyncCounts, b: Partial<SyncCounts>): SyncCounts {
  return {
    coursesProcessed: a.coursesProcessed + (b.coursesProcessed ?? 0),
    coursesSucceeded: a.coursesSucceeded + (b.coursesSucceeded ?? 0),
    coursesFailed: a.coursesFailed + (b.coursesFailed ?? 0),
    assignmentsCreated: a.assignmentsCreated + (b.assignmentsCreated ?? 0),
    assignmentsUpdated: a.assignmentsUpdated + (b.assignmentsUpdated ?? 0),
    assignmentsUnchanged: a.assignmentsUnchanged + (b.assignmentsUnchanged ?? 0),
    assignmentsMarkedMissing: a.assignmentsMarkedMissing + (b.assignmentsMarkedMissing ?? 0),
    submissionsUpserted: a.submissionsUpserted + (b.submissionsUpserted ?? 0),
    classificationsWritten: a.classificationsWritten + (b.classificationsWritten ?? 0),
    relevantCount: a.relevantCount + (b.relevantCount ?? 0),
    notRelevantCount: a.notRelevantCount + (b.notRelevantCount ?? 0),
    uncertainCount: a.uncertainCount + (b.uncertainCount ?? 0),
    itemsRejectedByValidation:
      a.itemsRejectedByValidation + (b.itemsRejectedByValidation ?? 0),
      };
}

/**
 * A run with zero courses is a SUCCESS, not a vacuous PARTIAL_SUCCESS: the
 * student genuinely has no courses and the run genuinely completed.
 *
 * This mirrors `app_finalize_sync_run`, which is the authority -- the database
 * derives the stored status from the work queue so no application bug can
 * record SUCCESS for a run that had a failed course. Kept here because the
 * projection the API returns has to agree with what was stored, and because a
 * pure function is where this rule can actually be tested.
 */
export function resolveRunStatus(courses: readonly CourseSyncResult[]): SyncRunStatus {
  if (courses.length === 0) return 'SUCCESS';
  const failed = courses.filter((course) => course.status === 'FAILED').length;
  const unfinished = courses.filter(
    (course) => course.status === 'PENDING' || course.status === 'RUNNING',
  ).length;
  // Not finished, so not an outcome. Reporting SUCCESS here would be the exact
  // "partial mistaken for complete" failure the state machine exists to stop.
  if (unfinished > 0) return 'RUNNING';
  if (failed === 0) return 'SUCCESS';
  if (failed === courses.length) return 'FAILED';
  return 'PARTIAL_SUCCESS';
}
