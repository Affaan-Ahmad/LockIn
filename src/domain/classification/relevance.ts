import type { StudentSectionProfile } from '@/domain/academic/types';
import { stableFingerprint } from '@/shared/hash';

import type { AssignmentSectionScope, ScopeEvidence, SectionScopeResolution } from './scope';
import { scopeIncludesStudent } from './scope';
import type { SectionScopeResolver } from './scope-resolver';

/**
 * Turns "what does this assignment target?" into "does it apply to me?".
 *
 * UNCERTAIN here means *needs review*: the system could not decide, so the
 * student is asked rather than guessed at. It is never a synonym for
 * NOT_RELEVANT, and the deadline feed keeps showing it.
 */
export type StudentRelevance = 'RELEVANT' | 'NOT_RELEVANT' | 'UNCERTAIN';

/** Which of the three deciders produced the answer. */
export type RelevanceSource = 'MANUAL_OVERRIDE' | 'GOOGLE_TARGETING' | 'SECTION_SCOPE';

export interface ManualOverride {
  readonly relevance: 'RELEVANT' | 'NOT_RELEVANT';
  readonly note: string | null;
  readonly decidedAt: Date;
}

export interface ClassifiableItem {
  readonly source: string;
  readonly sourceItemId: string;
  readonly title: string;
  readonly description: string | null;
  readonly topicName: string | null;
  /**
   * Google's assignee mode. ALL_STUDENTS means every student in the *course*,
   * which in a classroom shared by five sections says nothing about sections.
   */
  readonly assigneeMode: 'ALL_STUDENTS' | 'INDIVIDUAL_STUDENTS' | null;
  /** Null means Google did not expose the list. Not the same as an empty list. */
  readonly individualStudentIds: readonly string[] | null;
  readonly courseSectionLabel: string | null;
}

export interface RelevanceInput {
  readonly student: StudentSectionProfile;
  /** Classroom user id, when known. Null means "do not guess". */
  readonly googleUserId: string | null;
  readonly item: ClassifiableItem;
  readonly override: ManualOverride | null;
}

export interface RelevanceDecision {
  readonly relevance: StudentRelevance;
  readonly confidence: number;
  readonly decidedBy: string;
  readonly source: RelevanceSource;
  readonly reason: string;
  /** Always resolved and always recorded, even when it did not decide. */
  readonly scope: AssignmentSectionScope;
  readonly scopeConfidence: number;
  readonly scopeRule: string;
  readonly evidence: readonly ScopeEvidence[];
  readonly rulesetVersion: string;
}

/**
 * The classifier.
 *
 * Precedence is fixed and short, because these three deciders are not a
 * variation point -- the variation lives in the scope rules underneath:
 *
 *   1. The student's own decision. Nothing outranks it.
 *   2. Google's explicit per-student assignee list. Source truth, not inference.
 *   3. The resolved section scope.
 *
 * The scope is resolved on every call regardless of who decides, so a stored
 * verdict always carries the full picture: what the assignment targeted, and
 * why that produced this answer for this student.
 */
export class RelevanceClassifier {
  constructor(private readonly scopeResolver: SectionScopeResolver) {}

  get version(): string {
    return this.scopeResolver.version;
  }

  classify(input: RelevanceInput): RelevanceDecision {
    const resolution = this.scopeResolver.resolve({
      title: input.item.title,
      description: input.item.description,
      topicName: input.item.topicName,
    });

    const override = input.override;
    if (override !== null) {
      return this.decide(resolution, {
        relevance: override.relevance,
        confidence: 1,
        decidedBy: 'MANUAL_OVERRIDE',
        source: 'MANUAL_OVERRIDE',
        reason:
          override.relevance === 'RELEVANT'
            ? 'Marked as relevant by the student'
            : 'Marked as not relevant by the student',
      });
    }

    const targeting = evaluateGoogleTargeting(input);
    if (targeting !== null) return this.decide(resolution, targeting);

    return this.decide(resolution, relevanceFromScope(resolution.scope, input.student));
  }

  /**
   * Identifies every input the verdict depended on.
   *
   * Stored with the classification so an unchanged item can skip the rules on
   * the next sync. It must include the rule set version and the student's alias
   * set: omitting either would leave stale verdicts in place after a rule fix or
   * a corrected section, which is the one caching bug that produces confidently
   * wrong output.
   */
  fingerprintOf(input: RelevanceInput): string {
    return stableFingerprint([
      this.version,
      input.student.aliasSetVersion,
      input.googleUserId,
      input.item.source,
      input.item.sourceItemId,
      input.item.title,
      input.item.description,
      input.item.topicName,
      input.item.assigneeMode,
      input.item.individualStudentIds === null
        ? null
        : [...input.item.individualStudentIds].sort().join(','),
      input.item.courseSectionLabel,
      input.override === null
        ? null
        : `${input.override.relevance}@${input.override.decidedAt.toISOString()}`,
    ]);
  }

  private decide(
    resolution: SectionScopeResolution,
    verdict: {
      relevance: StudentRelevance;
      confidence: number;
      decidedBy: string;
      source: RelevanceSource;
      reason: string;
    },
  ): RelevanceDecision {
    return {
      ...verdict,
      scope: resolution.scope,
      scopeConfidence: resolution.confidence,
      scopeRule: resolution.rule,
      evidence: resolution.evidence,
      rulesetVersion: this.version,
    };
  }
}

/**
 * The heart of the false-negative protection.
 *
 * NOT_RELEVANT is reachable from exactly two branches, and both require
 * positive evidence that the coursework names other sections. There is no
 * branch that concludes "the student's section was not mentioned, therefore not
 * theirs" -- an unlabelled assignment resolves to ALL_SECTIONS upstream and
 * lands on the first line here.
 */
export function relevanceFromScope(
  scope: AssignmentSectionScope,
  student: StudentSectionProfile,
): {
  relevance: StudentRelevance;
  confidence: number;
  decidedBy: string;
  source: RelevanceSource;
  reason: string;
} {
  const base = { decidedBy: 'SECTION_SCOPE', source: 'SECTION_SCOPE' as const };

  switch (scope.type) {
    case 'ALL_SECTIONS':
      return {
        ...base,
        relevance: 'RELEVANT',
        confidence: 1,
        reason: 'Coursework applies to every section in the course',
      };

    case 'ALL_SECTIONS_EXCEPT': {
      const excluded = scopeIncludesStudent(scope.excluded, student);
      return {
        ...base,
        relevance: excluded ? 'NOT_RELEVANT' : 'RELEVANT',
        confidence: 0.95,
        reason: excluded
          ? `Coursework excludes section ${scope.excluded.join(', ')}, which is the student's section`
          : `Coursework applies to every section except ${scope.excluded.join(', ')}`,
      };
    }

    case 'SPECIFIC_SECTIONS': {
      const included = scopeIncludesStudent(scope.sections, student);
      return {
        ...base,
        relevance: included ? 'RELEVANT' : 'NOT_RELEVANT',
        // Deliberately at the schema's floor for hiding coursework. A scope
        // resolved at lower confidence cannot reach this branch, because the
        // rules that could produce one do not exist.
        confidence: included ? 0.95 : 0.85,
        reason: included
          ? `Coursework targets section ${scope.sections.join(', ')}, which includes the student`
          : `Coursework explicitly targets section ${scope.sections.join(', ')}`,
      };
    }

    case 'UNCERTAIN':
      return {
        ...base,
        relevance: 'UNCERTAIN',
        confidence: 0,
        reason: scope.reason,
      };
  }
}

/**
 * Google's per-student assignee list.
 *
 * Three deliberate abstentions, each of which would otherwise produce a
 * confident NOT_RELEVANT from missing data:
 *
 *   - ALL_STUDENTS tells us nothing about sections in a shared classroom;
 *   - an absent studentIds list is not an empty one;
 *   - an unknown Classroom user id must never be guessed at.
 */
function evaluateGoogleTargeting(input: RelevanceInput): {
  relevance: StudentRelevance;
  confidence: number;
  decidedBy: string;
  source: RelevanceSource;
  reason: string;
} | null {
  const { item, googleUserId } = input;
  if (item.assigneeMode !== 'INDIVIDUAL_STUDENTS') return null;

  const ids = item.individualStudentIds;
  if (ids === null || ids.length === 0) return null;
  if (googleUserId === null) return null;

  const included = ids.includes(googleUserId);

  return {
    relevance: included ? 'RELEVANT' : 'NOT_RELEVANT',
    confidence: 1,
    decidedBy: 'GOOGLE_TARGETING',
    source: 'GOOGLE_TARGETING',
    reason: included
      ? 'Google Classroom assigns this coursework directly to the student'
      : 'Google Classroom assigns this coursework to specific students that do not include the student',
  };
}
