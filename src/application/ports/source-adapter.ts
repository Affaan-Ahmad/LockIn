import type { ListingCompleteness } from '@/domain/assignment/lifecycle';
import type {
  AcademicSourceId,
  AssignmentSourceRecord,
  CourseSourceRecord,
  SubmissionSourceRecord,
  TopicSourceRecord,
} from '@/domain/assignment/types';
import type { SyncIssue } from '@/domain/sync/outcome';

/**
 * The port every academic content source implements.
 *
 * This is the main structural bet of the design: the sync service talks to this
 * interface and never to Google. Adding Moodle, a university LMS, an ICS feed
 * or manual entry means writing one adapter, not touching the sync pipeline,
 * the repositories, or the classifier.
 *
 * Note what is *not* here: no notion of pages, tokens, quotas or HTTP. Those
 * are the adapter's problem. What crosses this boundary is already validated,
 * already normalised, and already expressed in domain types.
 */
export interface AcademicSourceAdapter {
  readonly id: AcademicSourceId;

  listCourses(context: SourceRequestContext): Promise<SourceCourseListing>;

  /**
   * Everything needed to synchronise one course.
   *
   * Returned as a single call rather than three so the adapter can make its own
   * decisions about batching -- the Google implementation fetches every
   * submission for the course in one paginated request rather than one per
   * coursework item, and that optimisation stays invisible to the caller.
   */
  fetchCourseContent(
    context: SourceRequestContext,
    course: SourceCourseRef,
    options: FetchCourseContentOptions,
    ): Promise<SourceCourseContent>;
}

export interface SourceRequestContext {
  readonly userId: string;
  readonly syncRunId: string;
  /** Cooperative cancellation for a run that has lost its lease. */
  readonly signal?: AbortSignal;
}

export interface SourceCourseRef {
  readonly sourceCourseId: string;
  readonly name: string;
}

export interface FetchCourseContentOptions {
  /**
   * Watermark for incremental fetching. When set, the adapter may stop paging
   * once it passes items older than this. An adapter that cannot do so safely
   * must ignore it and report COMPLETE, never report COMPLETE for a prefix.
   */
  readonly updatedSince: Date | null;
}

export interface SourceCourseListing {
  readonly courses: readonly CourseSourceRecord[];
  readonly completeness: ListingCompleteness;
  readonly issues: readonly SyncIssue[];
}

export interface SourceCourseContent {
  readonly assignments: readonly AssignmentSourceRecord[];
  readonly topics: readonly TopicSourceRecord[];
  readonly submissions: readonly SubmissionSourceRecord[];
  /**
   * COMPLETE only when the adapter enumerated the entire course. Anything less
   * disables disappearance reconciliation for this course, because absence from
   * a partial listing is not evidence of removal.
   */
  readonly completeness: ListingCompleteness;
  /** Newest source update timestamp observed; becomes the next watermark. */
  readonly highWatermark: Date | null;
  /** Items rejected by validation, plus any recoverable problems encountered. */
  readonly issues: readonly SyncIssue[];
  readonly rejectedItemCount: number;
  /**
   * The source's own id for this student, if the adapter learned it while
   * fetching. Used to enable source-level targeting checks without spending an
   * extra API call or a broader OAuth scope.
   */
  readonly observedSourceUserId: string | null;
}
