import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';
import type { StudentSectionProfile } from '@/domain/academic/types';
import type { RelevanceInput } from '@/domain/classification/relevance';

/** The running example throughout the tests: BCS, batch 4, section G. */
export function studentG(): StudentSectionProfile {
  return buildStudentSectionProfile({
    primarySection: 'G',
    programCode: 'BCS',
    batch: '4',
  });
}

export function studentA(): StudentSectionProfile {
  return buildStudentSectionProfile({
    primarySection: 'A',
    programCode: 'BCS',
    batch: '4',
  });
}

export function relevanceInput(
  overrides: {
    student?: StudentSectionProfile;
    title?: string;
    description?: string | null;
    topicName?: string | null;
    assigneeMode?: 'ALL_STUDENTS' | 'INDIVIDUAL_STUDENTS' | null;
    individualStudentIds?: readonly string[] | null;
    googleUserId?: string | null;
    override?: RelevanceInput['override'];
    courseSectionLabel?: string | null;
  } = {},
): RelevanceInput {
  return {
    student: overrides.student ?? studentG(),
    googleUserId: overrides.googleUserId ?? null,
    override: overrides.override ?? null,
    item: {
      source: 'GOOGLE_CLASSROOM',
      sourceItemId: 'cw-1',
      title: overrides.title ?? 'Assignment 1',
      description: overrides.description ?? null,
      topicName: overrides.topicName ?? null,
      assigneeMode: overrides.assigneeMode ?? null,
      individualStudentIds: overrides.individualStudentIds ?? null,
      courseSectionLabel: overrides.courseSectionLabel ?? null,
    },
  };
}
