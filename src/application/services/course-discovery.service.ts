import type {
  CourseRepository,
  CourseTrackingRepository,
} from '@/application/ports/repositories';
import type { AcademicSourceAdapter } from '@/application/ports/source-adapter';
import type { ListingCompleteness } from '@/domain/assignment/lifecycle';
import type { DiscoveredCourse, TrackingDecision } from '@/domain/course/tracking';
import type { SyncIssue } from '@/domain/sync/outcome';
import type { Clock } from '@/shared/clock';
import { InvalidInputError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

/**
 * Course discovery, deliberately separate from coursework synchronisation.
 *
 * Discovery is cheap: one paginated `courses.list` call, then a single batch
 * upsert. Coursework synchronisation is expensive: per course, a topics call, a
 * paginated coursework sweep, a paginated submissions sweep, then upserts and
 * classification.
 *
 * Fusing them is what makes a student with four years of dead courses wait
 * through thousands of assignments they will never look at, on every sync. So
 * discovery runs for everything and answers "what could I track?", while
 * coursework sync runs only for what the student actually chose.
 */

export interface CourseDiscoveryDeps {
  readonly source: AcademicSourceAdapter;
  readonly courses: CourseRepository;
  readonly tracking: CourseTrackingRepository;
  readonly logger: Logger;
  readonly clock: Clock;
}

export interface DiscoveryResult {
  readonly courses: readonly DiscoveredCourse[];
  readonly completeness: ListingCompleteness;
  readonly issues: readonly SyncIssue[];
  readonly trackedCount: number;
  readonly undecidedCount: number;
}

export class CourseDiscoveryService {
  constructor(private readonly deps: CourseDiscoveryDeps) {}

  /**
   * Refreshes the course list from Google and returns it with tracking state.
   *
   * Never changes a tracking decision, including when Google reports a course
   * as archived. The student's choice outlives the source's state, and flipping
   * it automatically would make a course vanish from every tracked query --
   * indistinguishable from data loss to the person looking at the screen.
   */
  async discover(userId: string, syncRunId: string): Promise<DiscoveryResult> {
    const { deps } = this;

    const listing = await deps.source.listCourses({ userId, syncRunId });

    await deps.courses.upsertMany(userId, deps.source.id, listing.courses, deps.clock.now());

    const discovered = await deps.tracking.listDiscovered(userId);
    const trackedCount = discovered.filter((course) => course.decision === 'TRACKED').length;
    const undecidedCount = discovered.filter((course) => course.decidedAt === null).length;

    deps.logger.info('course discovery complete', {
      userId,
      syncRunId,
      discovered: discovered.length,
      trackedCount,
      undecidedCount,
      completeness: listing.completeness,
    });

    return {
      courses: discovered,
      completeness: listing.completeness,
      issues: listing.issues,
      trackedCount,
      undecidedCount,
    };
  }

  /** Reads the current selection without contacting Google. */
  async list(userId: string): Promise<readonly DiscoveredCourse[]> {
    return this.deps.tracking.listDiscovered(userId);
  }

  async setTracking(
    userId: string,
    decisions: readonly { courseId: string; decision: TrackingDecision }[],
    ): Promise<number> {
    if (decisions.length === 0) {
      throw new InvalidInputError('At least one course decision is required');
    }

    const updated = await this.deps.tracking.setTracking(userId, decisions);

    this.deps.logger.info('course tracking updated', {
      userId,
      requested: decisions.length,
      updated,
      tracked: decisions.filter((entry) => entry.decision === 'TRACKED').length,
    });

    return updated;
  }
}
