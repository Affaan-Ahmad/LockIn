import { describe, expect, it } from 'vitest';

import {
  fingerprintAssignment,
  mapCourse,
  mapCourseWork,
  mapStudentSubmission,
} from '@/infrastructure/google/classroom.mapper';
import {
  googleCourseWorkSchema,
  googleStudentSubmissionSchema,
} from '@/infrastructure/google/classroom.schemas';

/**
 * The trust boundary in both directions: what a valid payload must become, and
 * what an invalid one must not be allowed to become.
 */

function parseCourseWork(raw: unknown) {
  const parsed = googleCourseWorkSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`fixture failed validation: ${parsed.error.message}`);
  return parsed.data;
}

describe('external validation', () => {
  it('rejects coursework with no id', () => {
    expect(googleCourseWorkSchema.safeParse({ courseId: 'c1', title: 'x' }).success).toBe(false);
  });

  it('rejects coursework with an empty title', () => {
    // An untitled row cannot be presented to a student, so it must not be
    // stored at all rather than stored as a blank entry in their list.
    expect(
      googleCourseWorkSchema.safeParse({ id: 'w1', courseId: 'c1', title: '' }).success,
    ).toBe(false);
  });

  it('rejects a malformed timestamp instead of coercing it', () => {
    expect(
      googleCourseWorkSchema.safeParse({
        id: 'w1',
        courseId: 'c1',
        title: 'x',
        updateTime: 'last Tuesday',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-numeric due date component', () => {
    expect(
      googleCourseWorkSchema.safeParse({
        id: 'w1',
        courseId: 'c1',
        title: 'x',
        dueDate: { year: 'twenty twenty six', month: 3, day: 14 },
      }).success,
    ).toBe(false);
  });

  it('accepts numeric fields Google sometimes sends as strings', () => {
    const parsed = googleCourseWorkSchema.safeParse({
      id: 'w1',
      courseId: 'c1',
      title: 'x',
      maxPoints: '100',
      dueDate: { year: '2026', month: '3', day: '14' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.maxPoints).toBe(100);
    expect(parsed.data.dueDate?.year).toBe(2026);
  });

  it('accepts a payload with only the required fields', () => {
    expect(
      googleCourseWorkSchema.safeParse({ id: 'w1', courseId: 'c1', title: 'Quiz' }).success,
    ).toBe(true);
  });
});

describe('mapCourseWork', () => {
  it('maps a complete item', () => {
    const result = mapCourseWork(
      parseCourseWork({
        id: 'w1',
        courseId: 'c1',
        title: 'Assignment 3 - G',
        description: 'Submit on the portal',
        state: 'PUBLISHED',
        workType: 'ASSIGNMENT',
        maxPoints: 50,
        topicId: 't1',
        assigneeMode: 'ALL_STUDENTS',
        dueDate: { year: 2026, month: 3, day: 14 },
        dueTime: { hours: 18, minutes: 59 },
        creationTime: '2026-02-01T10:00:00Z',
        updateTime: '2026-02-05T10:00:00Z',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      source: 'GOOGLE_CLASSROOM',
      sourceItemId: 'w1',
      title: 'Assignment 3 - G',
      workType: 'ASSIGNMENT',
      sourceState: 'PUBLISHED',
      assigneeMode: 'ALL_STUDENTS',
      sourceTopicId: 't1',
    });
    expect(result.value.deadline.dueAt?.toISOString()).toBe('2026-03-14T18:59:00.000Z');
  });

  it('distinguishes an absent assignee list from an empty one', () => {
    // The distinction decides whether the source-targeting rule speaks or
    // abstains, so collapsing them would let missing data read as exclusion.
    const absent = mapCourseWork(
      parseCourseWork({ id: 'w1', courseId: 'c1', title: 'x', assigneeMode: 'INDIVIDUAL_STUDENTS' }),
    );
    const empty = mapCourseWork(
      parseCourseWork({
        id: 'w2',
        courseId: 'c1',
        title: 'x',
        assigneeMode: 'INDIVIDUAL_STUDENTS',
        individualStudentsOptions: { studentIds: [] },
      }),
    );

    expect(absent.ok && absent.value.individualStudentIds).toBeNull();
    expect(empty.ok && empty.value.individualStudentIds).toEqual([]);
  });

  it('maps an unknown assignee mode to null rather than a guess', () => {
    const result = mapCourseWork(
      parseCourseWork({
        id: 'w1',
        courseId: 'c1',
        title: 'x',
        assigneeMode: 'ASSIGNEE_MODE_UNSPECIFIED',
      }),
    );
    expect(result.ok && result.value.assigneeMode).toBeNull();
  });

  it('maps an unknown work type to UNSPECIFIED instead of failing', () => {
    // Google adding a new work type must not break a student's whole sync.
    const result = mapCourseWork(
      parseCourseWork({ id: 'w1', courseId: 'c1', title: 'x', workType: 'SOMETHING_NEW' }),
    );
    expect(result.ok && result.value.workType).toBe('UNSPECIFIED');
  });

  it('rejects an item whose deadline cannot be trusted', () => {
    // Storing it with a null deadline would present a dated assignment as
    // having none, which is worse than skipping and reporting it.
    const result = mapCourseWork(
      parseCourseWork({
        id: 'w1',
        courseId: 'c1',
        title: 'x',
        dueDate: { year: 2026, month: 2, day: 31 },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXTERNAL_VALIDATION_ERROR');
    expect(result.error.context['sourceItemId']).toBe('w1');
  });

  it('normalises whitespace-only strings to null', () => {
    const result = mapCourseWork(
      parseCourseWork({ id: 'w1', courseId: 'c1', title: 'x', description: '   ' }),
    );
    expect(result.ok && result.value.description).toBeNull();
  });
});

describe('mapStudentSubmission', () => {
  it('keeps an unreported lateness as unknown', () => {
    // Google omits `late` when false AND when unknown. We cannot tell them
    // apart, so null is the honest value; `false` would be an invention.
    const parsed = googleStudentSubmissionSchema.parse({
      id: 's1',
      courseId: 'c1',
      courseWorkId: 'w1',
      state: 'CREATED',
    });
    const result = mapStudentSubmission(parsed);
    expect(result.ok && result.value.late).toBeNull();
  });

  it('keeps state and lateness', () => {
    const parsed = googleStudentSubmissionSchema.parse({
      id: 's1',
      courseId: 'c1',
      courseWorkId: 'w1',
      state: 'TURNED_IN',
      late: true,
    });
    const result = mapStudentSubmission(parsed);
    expect(result.ok && result.value).toMatchObject({ state: 'TURNED_IN', late: true });
  });

  it('drops the grades Google sends', () => {
    // A privacy guarantee, not an implementation detail. Grades are the most
    // sensitive field in the Classroom payload and no feature reads them, so
    // they must not survive the mapper into anything that gets persisted.
    // Asserted on the way in, because by the time it reaches the database the
    // column is gone and the failure would be silent.
    const parsed = googleStudentSubmissionSchema.parse({
      id: 's1',
      courseId: 'c1',
      courseWorkId: 'w1',
      state: 'RETURNED',
      assignedGrade: 42,
      draftGrade: 38,
    });
    const result = mapStudentSubmission(parsed);

    expect(result.ok).toBe(true);
    const mapped: Record<string, unknown> = result.ok ? { ...result.value } : {};
    expect(Object.keys(mapped)).not.toContain('assignedGrade');
    expect(Object.keys(mapped)).not.toContain('draftGrade');
    expect(Object.values(mapped)).not.toContain(42);
    expect(Object.values(mapped)).not.toContain(38);
  });
});

describe('mapCourse', () => {
  it('preserves the section string Google supplies', () => {
    const result = mapCourse({ id: 'c1', name: 'Data Structures', section: 'BCS-4' });
    expect(result.ok && result.value.section).toBe('BCS-4');
  });
});

describe('fingerprintAssignment', () => {
  const base = parseCourseWork({
    id: 'w1',
    courseId: 'c1',
    title: 'Assignment 3',
    dueDate: { year: 2026, month: 3, day: 14 },
    dueTime: { hours: 18, minutes: 59 },
    updateTime: '2026-02-05T10:00:00Z',
  });

  function fingerprintOf(overrides: Record<string, unknown> = {}): string {
    const result = mapCourseWork(parseCourseWork({ ...base, ...overrides }));
    if (!result.ok) throw new Error('fixture failed to map');
    return fingerprintAssignment(result.value);
  }

  it('is stable for identical input', () => {
    expect(fingerprintOf()).toBe(fingerprintOf());
  });

  it.each([
    ['title', { title: 'Assignment 3 - G' }],
    ['description', { description: 'new text' }],
    ['due date', { dueDate: { year: 2026, month: 3, day: 15 } }],
    ['due time', { dueTime: { hours: 19, minutes: 0 } }],
    ['state', { state: 'DRAFT' }],
    ['topic', { topicId: 't2' }],
    ['update time', { updateTime: '2026-02-06T10:00:00Z' }],
  ])('changes when %s changes', (_label, overrides) => {
    // A fingerprint that missed a field would let a real edit be skipped as
    // "unchanged", leaving a stale title or a stale deadline in place.
    expect(fingerprintOf(overrides)).not.toBe(fingerprintOf());
  });

  it('is insensitive to the order of the assignee list', () => {
    const a = fingerprintOf({
      assigneeMode: 'INDIVIDUAL_STUDENTS',
      individualStudentsOptions: { studentIds: ['x', 'y'] },
    });
    const b = fingerprintOf({
      assigneeMode: 'INDIVIDUAL_STUDENTS',
      individualStudentsOptions: { studentIds: ['y', 'x'] },
    });
    expect(a).toBe(b);
  });
});
