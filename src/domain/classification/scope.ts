import type { StudentSectionProfile } from '@/domain/academic/types';

import type { ItemMentions } from './mentions-context';

/**
 * The scope of a piece of coursework: which sections it was written for.
 *
 * This is a property of the *assignment*, not of any student. It is determined
 * without knowing who is asking, which is what keeps the two questions
 * separable:
 *
 *   1. What does this assignment target?      <- this file
 *   2. Does that include me?                  <- relevance.ts
 *
 * Collapsing them produces rules that reason about a title and a student at the
 * same time, and those rules are where "the student's section was not mentioned,
 * therefore this is not theirs" creeps in. Here, that inference is not even
 * expressible: a scope has no idea a student exists.
 */
export type AssignmentSectionScope =
  /** No section restriction found. The default in a shared classroom. */
  | { readonly type: 'ALL_SECTIONS' }
  /** Everyone but the listed sections: "all sections except B". */
  | { readonly type: 'ALL_SECTIONS_EXCEPT'; readonly excluded: readonly string[] }
  /** Only the listed sections: "Section G", "Sections F/G". */
  | { readonly type: 'SPECIFIC_SECTIONS'; readonly sections: readonly string[] }
  /** Section targeting exists but could not be resolved safely. */
  | { readonly type: 'UNCERTAIN'; readonly reason: string };

export type ScopeEvidenceSource = 'TITLE' | 'DESCRIPTION' | 'TOPIC';

export interface ScopeEvidence {
  readonly source: ScopeEvidenceSource;
  /** The exact substring the decision rested on. */
  readonly matchedText: string;
  readonly detail: string;
}

export interface SectionScopeResolution {
  readonly scope: AssignmentSectionScope;
  /** 0..1. Carried into the relevance decision; never invented by the caller. */
  readonly confidence: number;
  readonly evidence: readonly ScopeEvidence[];
  /** Id of the rule that produced this scope. */
  readonly rule: string;
}

/** What a scope rule is allowed to look at. Deliberately excludes the student. */
export interface ScopeContext {
  readonly title: string;
  readonly description: string | null;
  readonly topicName: string | null;
  /** Tokenised once by the resolver, shared by every rule. */
  readonly mentions: ItemMentions;
}

export interface ScopeOutcome {
  readonly scope: AssignmentSectionScope;
  readonly confidence: number;
  readonly evidence: readonly ScopeEvidence[];
}

/**
 * The extension point for university naming conventions.
 *
 * Supporting a new convention means adding one implementation and registering
 * it. No existing rule changes, and neither does the resolver: precedence comes
 * from `priority`, and a rule that does not recognise an item returns null.
 *
 * Abstention is not a vote for ALL_SECTIONS. Only `noSectionRestrictionRule`
 * may conclude that, and only from a genuine absence of evidence.
 */
export interface SectionScopeRule {
  readonly id: string;
  /**
   * Higher wins. Rules that share a priority and agree on the scope type are
   * merged; rules that share a priority and disagree produce UNCERTAIN.
   */
  readonly priority: number;
  evaluate(context: ScopeContext): ScopeOutcome | null;
}

export const ScopePriority = {
  /** Section targeting exists but is unresolvable. Outranks any reading of it. */
  AMBIGUOUS: 500,
  /** "all sections except B" -- scope and carve-out are one construct. */
  UNIVERSAL_EXCEPT: 450,
  /** "all sections" stated outright. */
  UNIVERSAL: 400,
  /** "Section G" in the title: the primary targeting field. */
  TITLE_EXPLICIT: 320,
  /** "Assignment 3 - F/G": a labelled list with no "section" keyword. */
  TITLE_LIST: 310,
  /** "BCS-4G" in the title. */
  TITLE_CODE: 305,
  /** The Classroom topic the post was filed under. */
  TOPIC: 200,
  /** A section named in the body text. Weakest positive signal we act on. */
  DESCRIPTION: 100,
  /** Absence of evidence. Always last. */
  DEFAULT: 0,
} as const;

/** True when the scope names this student's section, for SPECIFIC scopes. */
export function scopeIncludesStudent(
  sections: readonly string[],
  student: StudentSectionProfile,
): boolean {
  return sections.some(
    (section) => student.sectionKeys.has(section) || student.aliasKeys.has(section),
  );
}
