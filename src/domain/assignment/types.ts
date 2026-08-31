import type { Deadline } from './deadline';
import type { LifecycleStatus, SourceState } from './lifecycle';

/**
 * Where a piece of academic work came from.
 *
 * A plain discriminator rather than a Google-shaped field, because the whole
 * point is that adding Moodle, a university LMS, an email parser or manual
 * entry later must not require reshaping the assignment model. Uniqueness is
 * scoped as (userId, source, sourceItemId) so two sources can legitimately use
 * the same id.
 */
export type AcademicSourceId = 'GOOGLE_CLASSROOM' | 'MANUAL';

export type WorkType =
  | 'ASSIGNMENT'
  | 'SHORT_ANSWER_QUESTION'
  | 'MULTIPLE_CHOICE_QUESTION'
  | 'MATERIAL'
  | 'UNSPECIFIED';

export type AssigneeMode = 'ALL_STUDENTS' | 'INDIVIDUAL_STUDENTS';

/**
 * Source fields only.
 *
 * Nothing derived lives on this type. Classification, overrides and freshness
 * are separate structures with separate owners, so a sync that rewrites source
 * data cannot touch a conclusion or a user decision.
 */
export interface AssignmentSourceRecord {
  readonly source: AcademicSourceId;
  readonly sourceItemId: string;
  readonly sourceCourseId: string;
  readonly title: string;
  readonly description: string | null;
  readonly workType: WorkType;
  readonly sourceState: SourceState;
  readonly maxPoints: number | null;
  readonly alternateLink: string | null;
  readonly sourceTopicId: string | null;
  readonly assigneeMode: AssigneeMode | null;
  readonly individualStudentIds: readonly string[] | null;
  readonly deadline: Deadline;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
}

export interface AssignmentLocalState {
  readonly lifecycleStatus: LifecycleStatus;
  readonly missingStreak: number;
  readonly firstMissingAt: Date | null;
  readonly lastSyncedAt: Date;
  /** Hash of the source fields, used to skip no-op writes. */
  readonly sourceFingerprint: string;
}

export type SubmissionState =
  | 'NEW'
  | 'CREATED'
  | 'TURNED_IN'
  | 'RETURNED'
  | 'RECLAIMED_BY_STUDENT'
  | 'UNSPECIFIED';

export interface SubmissionSourceRecord {
  readonly source: AcademicSourceId;
  readonly sourceSubmissionId: string;
  readonly sourceItemId: string;
  readonly sourceCourseId: string;
  readonly state: SubmissionState;
  /** Null when the source did not tell us, which is not the same as "on time". */
  readonly late: boolean | null;
  readonly alternateLink: string | null;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
}

export interface CourseSourceRecord {
  readonly source: AcademicSourceId;
  readonly sourceCourseId: string;
  readonly name: string;
  /** Google's course-level section string. Frequently absent or unhelpful. */
  readonly section: string | null;
  readonly descriptionHeading: string | null;
  readonly room: string | null;
  readonly courseState: string;
  readonly alternateLink: string | null;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
}

export interface TopicSourceRecord {
  readonly source: AcademicSourceId;
  readonly sourceTopicId: string;
  readonly sourceCourseId: string;
  readonly name: string;
  readonly sourceUpdatedAt: Date | null;
}
