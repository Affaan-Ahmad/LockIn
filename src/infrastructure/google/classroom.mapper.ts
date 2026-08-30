import { resolveGoogleDeadline } from '@/domain/assignment/deadline';
import type { SourceState } from '@/domain/assignment/lifecycle';
import type {
  AssigneeMode,
  AssignmentSourceRecord,
  CourseSourceRecord,
  SubmissionSourceRecord,
  SubmissionState,
  TopicSourceRecord,
  WorkType,
} from '@/domain/assignment/types';
import { ExternalValidationError } from '@/shared/errors';
import { stableFingerprint } from '@/shared/hash';
import type { Result } from '@/shared/result';
import { err, ok } from '@/shared/result';

import type {
  GoogleCourse,
  GoogleCourseWork,
  GoogleStudentSubmission,
  GoogleTopic,
} from './classroom.schemas';

/**
 * Google-shaped data to domain-shaped data.
 *
 * Two rules govern everything here.
 *
 * NEVER INVENT. Where Google said nothing, the domain record says null. There
 * are no "sensible defaults": no 23:59 due time, no assumed ALL_STUDENTS, no
 * `late: false` for a submission whose lateness was not reported. A null that
 * means "we do not know" is honest; a default that looks like data is not.
 *
 * FAIL PER ITEM, NOT PER BATCH. Mapping returns a Result so that one
 * unmappable coursework item is skipped and reported while the other four
 * hundred and ninety-nine are ingested. An exception here would discard a whole
 * course's sync because of one malformed row.
 */

export function mapCourse(course: GoogleCourse): Result<CourseSourceRecord, ExternalValidationError> {
  return ok({
    source: 'GOOGLE_CLASSROOM',
    sourceCourseId: course.id,
    name: course.name,
    section: emptyToNull(course.section),
    descriptionHeading: emptyToNull(course.descriptionHeading),
    room: emptyToNull(course.room),
    courseState: course.courseState ?? 'UNSPECIFIED',
    alternateLink: emptyToNull(course.alternateLink),
    sourceCreatedAt: parseInstant(course.creationTime),
    sourceUpdatedAt: parseInstant(course.updateTime),
  });
}

export function mapTopic(topic: GoogleTopic): Result<TopicSourceRecord, ExternalValidationError> {
  return ok({
    source: 'GOOGLE_CLASSROOM',
    sourceTopicId: topic.topicId,
    sourceCourseId: topic.courseId,
    name: topic.name,
    sourceUpdatedAt: parseInstant(topic.updateTime),
  });
}

export function mapCourseWork(
  work: GoogleCourseWork,
): Result<AssignmentSourceRecord, ExternalValidationError> {
  const deadline = resolveGoogleDeadline(work.dueDate ?? null, work.dueTime ?? null);
  if (!deadline.ok) {
    // A coursework item whose deadline we cannot trust is rejected outright
    // rather than stored with a null due date. Storing it would silently
    // present a dated assignment as having no deadline, which is the exact
    // failure this project exists to avoid.
    return err(
      new ExternalValidationError(
        `Coursework ${work.id} has an unusable deadline: ${deadline.issue}`,
        { context: { sourceItemId: work.id, courseId: work.courseId, issue: deadline.issue } },
      ),
    );
  }

  const assigneeMode = mapAssigneeMode(work.assigneeMode);

  const record: AssignmentSourceRecord = {
    source: 'GOOGLE_CLASSROOM',
    sourceItemId: work.id,
    sourceCourseId: work.courseId,
    title: work.title,
    description: emptyToNull(work.description),
    workType: mapWorkType(work.workType),
    sourceState: mapSourceState(work.state),
    maxPoints: work.maxPoints ?? null,
    alternateLink: emptyToNull(work.alternateLink),
    sourceTopicId: emptyToNull(work.topicId),
    assigneeMode,
    // Absent options and an empty studentIds array are different facts. The
    // first means "Google did not tell us"; only the second is a real list.
    // Collapsing them would let the targeting rule conclude "not assigned to
    // you" from missing data.
    individualStudentIds:
      work.individualStudentsOptions === undefined
        ? null
        : (work.individualStudentsOptions.studentIds ?? null),
    deadline: deadline.deadline,
    sourceCreatedAt: parseInstant(work.creationTime),
    sourceUpdatedAt: parseInstant(work.updateTime),
  };

  return ok(record);
}

export function mapStudentSubmission(
  submission: GoogleStudentSubmission,
): Result<SubmissionSourceRecord, ExternalValidationError> {
  return ok({
    source: 'GOOGLE_CLASSROOM',
    sourceSubmissionId: submission.id,
    sourceItemId: submission.courseWorkId,
    sourceCourseId: submission.courseId,
    state: mapSubmissionState(submission.state),
    // Google omits `late` when it is false *and* when it is unknown. We cannot
    // distinguish those, so absence stays null rather than becoming "on time".
    late: submission.late ?? null,
    assignedGrade: submission.assignedGrade ?? null,
    draftGrade: submission.draftGrade ?? null,
    alternateLink: emptyToNull(submission.alternateLink),
    sourceCreatedAt: parseInstant(submission.creationTime),
    sourceUpdatedAt: parseInstant(submission.updateTime),
  });
}

/**
 * Fingerprint of every source field we persist.
 *
 * Drives "did Google actually change anything?" and therefore whether a row is
 * rewritten and whether classification re-runs. It must cover every field that
 * can affect either, which is why the deadline is decomposed rather than
 * hashed as an object -- an object's key order is not guaranteed stable.
 */
export function fingerprintAssignment(record: AssignmentSourceRecord): string {
  return stableFingerprint([
    record.source,
    record.sourceItemId,
    record.title,
    record.description,
    record.workType,
    record.sourceState,
    record.maxPoints,
    record.alternateLink,
    record.sourceTopicId,
    record.assigneeMode,
    record.individualStudentIds === null ? null : [...record.individualStudentIds].sort().join(','),
    record.deadline.precision,
    record.deadline.dueDate === null
      ? null
      : `${String(record.deadline.dueDate.year)}-${String(record.deadline.dueDate.month)}-${String(record.deadline.dueDate.day)}`,
    record.deadline.dueTime === null
      ? null
      : `${String(record.deadline.dueTime.hours)}:${String(record.deadline.dueTime.minutes)}:${String(record.deadline.dueTime.seconds)}`,
    record.sourceUpdatedAt === null ? null : record.sourceUpdatedAt.toISOString(),
  ]);
}

// ---------------------------------------------------------------------------
// Enum mapping.
//
// Unknown values map to UNSPECIFIED rather than throwing: Google adding a new
// work type should not break a student's sync. Unknown is a truthful value --
// it says "the source told us something we do not model yet" -- and it is
// visibly different from the values we do understand.
// ---------------------------------------------------------------------------

function mapWorkType(value: string | undefined): WorkType {
  switch (value) {
    case 'ASSIGNMENT':
    case 'SHORT_ANSWER_QUESTION':
    case 'MULTIPLE_CHOICE_QUESTION':
      return value;
    default:
      return 'UNSPECIFIED';
  }
}

function mapSourceState(value: string | undefined): SourceState {
  switch (value) {
    case 'PUBLISHED':
    case 'DRAFT':
    case 'DELETED':
      return value;
    default:
      return 'UNSPECIFIED';
  }
}

function mapAssigneeMode(value: string | undefined): AssigneeMode | null {
  switch (value) {
    case 'ALL_STUDENTS':
    case 'INDIVIDUAL_STUDENTS':
      return value;
    default:
      // Includes ASSIGNEE_MODE_UNSPECIFIED and anything new. Null keeps the
      // targeting rule abstaining instead of reading a guess as source truth.
      return null;
  }
}

function mapSubmissionState(value: string | undefined): SubmissionState {
  switch (value) {
    case 'NEW':
    case 'CREATED':
    case 'TURNED_IN':
    case 'RETURNED':
    case 'RECLAIMED_BY_STUDENT':
      return value;
    default:
      return 'UNSPECIFIED';
  }
}

function parseInstant(value: string | undefined): Date | null {
  if (value === undefined || value === '') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : value;
}
