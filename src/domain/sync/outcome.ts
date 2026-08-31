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
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  /** Lease expired without a terminal status; the process died mid-run. */
  | 'ABANDONED';

export type CourseSyncStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

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
 */
export function resolveRunStatus(courses: readonly CourseSyncResult[]): SyncRunStatus {
  if (courses.length === 0) return 'SUCCESS';
  const failed = courses.filter((course) => course.status === 'FAILED').length;
  if (failed === 0) return 'SUCCESS';
  if (failed === courses.length) return 'FAILED';
  return 'PARTIAL_SUCCESS';
}
