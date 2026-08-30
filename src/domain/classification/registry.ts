import { RelevanceClassifier } from './relevance';
import type { SectionScopeRule } from './scope';
import { SectionScopeResolver } from './scope-resolver';
import {
  descriptionSectionRule,
  explicitSectionWordRule,
  sectionAliasCodeRule,
  sectionSlashListRule,
  topicSectionRule,
} from './scope-rules/naming-rules';
import {
  ambiguousSectionPhraseRule,
  noSectionRestrictionRule,
  universalExceptRule,
  universalScopeRule,
} from './scope-rules/shape-rules';

/**
 * Bump on any change to rule behaviour, priorities, confidences, or the mention
 * tokeniser. Every stored classification records the version it was produced
 * under; a mismatch escalates the next sync to a full pass, so a rule fix
 * reaches existing rows without a manual backfill.
 *
 * History:
 *   1.0.0 - initial deterministic rule set.
 *   2.0.0 - section scope separated from student relevance; unlabelled
 *           coursework now resolves to ALL_SECTIONS rather than a low-confidence
 *           guess, and ambiguous section phrases are detected explicitly.
 */
export const RULESET_VERSION = '2.0.0';

/**
 * The registry.
 *
 * Supporting another university's naming convention means writing one
 * SectionScopeRule and adding a line here. No existing rule and no resolver
 * code changes, and array order is irrelevant because precedence comes from
 * each rule's `priority` -- which removes a whole class of accidental-reordering
 * bug and merge conflict.
 */
export const defaultScopeRules: readonly SectionScopeRule[] = [
  // Shape of the phrase: decides how any names inside should be read.
  ambiguousSectionPhraseRule,
  universalExceptRule,
  universalScopeRule,
  // Naming conventions: where new universities plug in.
  explicitSectionWordRule,
  sectionSlashListRule,
  sectionAliasCodeRule,
  topicSectionRule,
  descriptionSectionRule,
  // Absence of evidence. Always last.
  noSectionRestrictionRule,
];

export function createSectionScopeResolver(
  rules: readonly SectionScopeRule[] = defaultScopeRules,
  rulesetVersion: string = RULESET_VERSION,
): SectionScopeResolver {
  return new SectionScopeResolver({ rules, rulesetVersion });
}

export function createRelevanceClassifier(
  rules: readonly SectionScopeRule[] = defaultScopeRules,
  rulesetVersion: string = RULESET_VERSION,
): RelevanceClassifier {
  return new RelevanceClassifier(createSectionScopeResolver(rules, rulesetVersion));
}
