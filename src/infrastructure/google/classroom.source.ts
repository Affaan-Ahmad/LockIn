import 'server-only';

import type {
  AcademicSourceAdapter,
  FetchCourseContentOptions,
  SourceCourseContent,
  SourceCourseListing,
  SourceCourseRef,
  SourceRequestContext,
} from '@/application/ports/source-adapter';
import type { GoogleCredentialProvider } from '@/application/ports/google-credentials';
import type { ListingCompleteness } from '@/domain/assignment/lifecycle';
import type {
  AssignmentSourceRecord,
  CourseSourceRecord,
  SubmissionSourceRecord,
  TopicSourceRecord,
} from '@/domain/assignment/types';
import type { SyncIssue } from '@/domain/sync/outcome';
import { toAppError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

import { GoogleClassroomClient } from './classroom.client';
import {
  mapCourse,
  mapCourseWork,
  mapStudentSubmission,
  mapTopic,
} from './classroom.mapper';

/**
 * Google Classroom as an AcademicSourceAdapter.
 *
 * This is the seam that keeps Google from becoming load-bearing in the domain.
 * The sync service knows only the port; swapping in Moodle, or adding it
 * alongside, needs no change here or above.
 *
 * The adapter's other job is to be honest about completeness. It reports
 * COMPLETE only when it genuinely enumerated everything -- if pagination was
 * cut short by the early-stop watermark or the page ceiling, it says PARTIAL,
 * and the sync service then refuses to reconcile disappearances for that
 * course. Getting this wrong in the optimistic direction would soft-delete a
 * student's coursework after a single truncated response.
 */
export class GoogleClassroomSource implements AcademicSourceAdapter {
  readonly id = 'GOOGLE_CLASSROOM' as const;

  private readonly credentials: GoogleCredentialProvider;
  private readonly logger: Logger;
  private readonly maxRetryAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: {
    credentials: GoogleCredentialProvider;
    logger: Logger;
    maxRetryAttempts: number;
    requestTimeoutMs: number;
    fetchImpl?: typeof fetch;
  }) {
    this.credentials = options.credentials;
    this.logger = options.logger;
    this.maxRetryAttempts = options.maxRetryAttempts;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl;
  }

  async listCourses(context: SourceRequestContext): Promise<SourceCourseListing> {
    const client = await this.clientFor(context);
    const logger = this.contextLogger(context);

    const page = await client.listCourses();
    const courses: CourseSourceRecord[] = [];
    const issues: SyncIssue[] = [];

    for (const course of page.items) {
      const mapped = mapCourse(course);
      if (!mapped.ok) {
        issues.push(issueFromError(mapped.error, 'COURSE', course.id, null));
        logger.warn('skipped unmappable course', { sourceCourseId: course.id });
        continue;
      }
      courses.push(mapped.value);
    }

    return {
      courses,
      completeness: page.exhausted ? 'COMPLETE' : 'PARTIAL',
      issues,
    };
  }

  async fetchCourseContent(
    context: SourceRequestContext,
    course: SourceCourseRef,
    options: FetchCourseContentOptions,
  ): Promise<SourceCourseContent> {
    const client = await this.clientFor(context);
    const logger = this.contextLogger(context).child({ sourceCourseId: course.sourceCourseId });

    const issues: SyncIssue[] = [];
    let rejected = 0;

    // Topics are fetched first because coursework references them, and a topic
    // name is one of the strongest section signals available.
    const topicsPage = await client.listTopics(course.sourceCourseId);
    const topics: TopicSourceRecord[] = [];
    for (const topic of topicsPage.items) {
      const mapped = mapTopic(topic);
      if (!mapped.ok) {
        rejected += 1;
        issues.push(issueFromError(mapped.error, 'ITEM', course.sourceCourseId, topic.topicId));
        continue;
      }
      topics.push(mapped.value);
    }

    const workPage = await client.listCourseWork(course.sourceCourseId, {
      updatedSince: options.updatedSince,
    });

    const assignments: AssignmentSourceRecord[] = [];
    let highWatermark: Date | null = null;

    for (const work of workPage.items) {
      const mapped = mapCourseWork(work);
      if (!mapped.ok) {
        rejected += 1;
        issues.push(issueFromError(mapped.error, 'ITEM', course.sourceCourseId, work.id));
        logger.warn('skipped unmappable coursework', {
          sourceItemId: work.id,
          reason: mapped.error.message,
        });
        continue;
      }
      assignments.push(mapped.value);

      const updated = mapped.value.sourceUpdatedAt;
      if (updated !== null && (highWatermark === null || updated > highWatermark)) {
        highWatermark = updated;
      }
    }

    const submissionsPage = await client.listStudentSubmissions(course.sourceCourseId);
    const submissions: SubmissionSourceRecord[] = [];
    let observedSourceUserId: string | null = null;

    for (const submission of submissionsPage.items) {
      // Classroom stamps every submission with the student's own user id. Taking
      // it from here means source-level targeting checks work without paying for
      // a roster or profile scope we would otherwise not need.
      if (observedSourceUserId === null && submission.userId !== undefined) {
        observedSourceUserId = submission.userId;
      }

      const mapped = mapStudentSubmission(submission);
      if (!mapped.ok) {
        rejected += 1;
        issues.push(issueFromError(mapped.error, 'ITEM', course.sourceCourseId, submission.id));
        continue;
      }
      submissions.push(mapped.value);
    }

    const completeness = resolveCompleteness([
      topicsPage.exhausted,
      workPage.exhausted,
      submissionsPage.exhausted,
    ]);

    if (completeness === 'PARTIAL') {
      logger.debug('course listing is a prefix; disappearance reconciliation will be skipped', {
        courseWorkPages: workPage.pagesFetched,
        incremental: options.updatedSince !== null,
      });
    }

    return {
      assignments,
      topics,
      submissions,
      completeness,
      highWatermark,
      issues,
      rejectedItemCount: rejected,
      observedSourceUserId,
    };
  }

  private async clientFor(context: SourceRequestContext): Promise<GoogleClassroomClient> {
    const accessToken = await this.credentials.getAccessToken(context.userId);
    return new GoogleClassroomClient({
      accessToken,
      logger: this.contextLogger(context),
      maxRetryAttempts: this.maxRetryAttempts,
      requestTimeoutMs: this.requestTimeoutMs,
      ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
  }

  private contextLogger(context: SourceRequestContext): Logger {
    return this.logger.child({
      source: this.id,
      userId: context.userId,
      syncRunId: context.syncRunId,
    });
  }
}

/**
 * A course listing is only complete when every collection within it was
 * exhausted. Any prefix anywhere makes the whole thing a prefix.
 */
function resolveCompleteness(exhaustedFlags: readonly boolean[]): ListingCompleteness {
  return exhaustedFlags.every(Boolean) ? 'COMPLETE' : 'PARTIAL';
}

function issueFromError(
  error: unknown,
  scope: SyncIssue['scope'],
  sourceCourseId: string | null,
  sourceItemId: string | null,
): SyncIssue {
  const appError = toAppError(error);
  return {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable,
    scope,
    sourceCourseId,
    sourceItemId,
  };
}
