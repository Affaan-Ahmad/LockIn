/**
 * The things the student writes.
 *
 * Everything else in this domain describes what Google said. These two describe
 * what the student said, which makes them the only records here that cannot be
 * reconstructed by syncing again — and the reason they are modelled separately
 * rather than bolted onto an assignment as another column.
 */

/** A note on one of the student's own assignments. One per assignment. */
export interface AssignmentNote {
  readonly assignmentId: string;
  readonly body: string;
  readonly updatedAt: Date;
}

/**
 * What a student-added calendar entry is.
 *
 * A closed set, but a deliberately unambitious one: it exists to pick an icon
 * and a word, not to drive behaviour. Nothing in the system treats a QUIZ
 * differently from an EXAM, and the moment something does, that rule should be
 * the thing being modelled rather than this label.
 */
export type UserEventKind = 'QUIZ' | 'EXAM' | 'ASSIGNMENT' | 'CLASS' | 'OTHER';

export const USER_EVENT_KINDS: readonly UserEventKind[] = [
  'QUIZ',
  'EXAM',
  'ASSIGNMENT',
  'CLASS',
  'OTHER',
];

export const USER_EVENT_KIND_LABEL: Readonly<Record<UserEventKind, string>> = {
  QUIZ: 'Quiz',
  EXAM: 'Exam',
  ASSIGNMENT: 'Assignment',
  CLASS: 'Class',
  OTHER: 'Other',
};

export function isUserEventKind(value: unknown): value is UserEventKind {
  return (USER_EVENT_KINDS as readonly unknown[]).includes(value);
}

/**
 * A dated entry the student added themselves.
 *
 * The motivating case is the quiz announced out loud and never posted to
 * Classroom: real, dated, and invisible to every sync. It carries no assignment
 * id precisely because it exists for the work that has no assignment.
 */
export interface UserEvent {
  readonly id: string;
  readonly title: string;
  readonly kind: UserEventKind;
  readonly startsAt: Date;
  readonly note: string | null;
}

/** What a caller supplies to create one. The id and timestamps are the store's. */
export interface UserEventDraft {
  readonly title: string;
  readonly kind: UserEventKind;
  readonly startsAt: Date;
  readonly note: string | null;
}
