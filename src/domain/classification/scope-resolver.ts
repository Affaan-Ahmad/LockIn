import { buildItemMentions } from './mentions-context';
import type {
  AssignmentSectionScope,
  ScopeContext,
  ScopeEvidence,
  SectionScopeResolution,
  SectionScopeRule,
} from './scope';

/**
 * Runs the registered scope rules and picks one answer.
 *
 * Pure and synchronous. No student, no clock, no I/O -- so a scope decision is
 * reproducible from the title, description and topic alone, which is what makes
 * a misclassification a one-line test case.
 *
 * Resolution is three steps:
 *
 *   1. Every rule evaluates. Rules never see each other and may abstain.
 *   2. The highest priority that produced anything wins outright. Lower
 *      priorities are discarded, not blended -- so a description mention cannot
 *      dilute an explicit title.
 *   3. Rules that tie on priority are merged if they agree on the scope type,
 *      and produce UNCERTAIN if they do not.
 */

export interface ScopeResolverOptions {
  readonly rules: readonly SectionScopeRule[];
  readonly rulesetVersion: string;
}

export interface ScopeInput {
  readonly title: string;
  readonly description: string | null;
  readonly topicName: string | null;
}

export class SectionScopeResolver {
  private readonly rules: readonly SectionScopeRule[];
  readonly version: string;

  constructor(options: ScopeResolverOptions) {
    if (options.rules.length === 0) {
      throw new Error('SectionScopeResolver requires at least one rule');
    }
    const ids = new Set(options.rules.map((rule) => rule.id));
    if (ids.size !== options.rules.length) {
      // Duplicate ids would make the recorded provenance ambiguous.
      throw new Error('SectionScopeResolver received duplicate rule ids');
    }
    this.rules = options.rules;
    this.version = options.rulesetVersion;
  }

  resolve(input: ScopeInput): SectionScopeResolution {
    const context: ScopeContext = {
      title: input.title,
      description: input.description,
      topicName: input.topicName,
      mentions: buildItemMentions(input),
    };

    const outcomes = this.rules
      .map((rule) => ({ rule, outcome: rule.evaluate(context) }))
      .filter((entry): entry is { rule: SectionScopeRule; outcome: NonNullable<typeof entry.outcome> } =>
        entry.outcome !== null,
      );

    if (outcomes.length === 0) {
      // Reachable only if the default rule is unregistered or abstained, which
      // means section-shaped text exists that no rule could interpret.
      return {
        scope: {
          type: 'UNCERTAIN',
          reason: 'Section information appears to be present but no rule could interpret it',
        },
        confidence: 0,
        evidence: [],
        rule: 'NO_RULE_MATCHED',
      };
    }

    const topPriority = Math.max(...outcomes.map((entry) => entry.rule.priority));
    const deciding = outcomes.filter((entry) => entry.rule.priority === topPriority);

    const types = new Set(deciding.map((entry) => entry.outcome.scope.type));
    const evidence: ScopeEvidence[] = deciding.flatMap((entry) => [...entry.outcome.evidence]);

    if (types.size > 1) {
      return {
        scope: {
          type: 'UNCERTAIN',
          reason: `Rules at the same precedence disagreed about the scope (${deciding
            .map((entry) => `${entry.rule.id}=${entry.outcome.scope.type}`)
            .join(', ')})`,
        },
        confidence: 0,
        evidence,
        rule: 'SCOPE_CONFLICT',
      };
    }

    const winner = deciding.reduce((best, candidate) =>
      candidate.outcome.confidence > best.outcome.confidence ? candidate : best,
    );

    return {
      scope: mergeScopes(deciding.map((entry) => entry.outcome.scope), winner.outcome.scope),
      confidence: winner.outcome.confidence,
      evidence,
      rule: winner.rule.id,
    };
  }
}

/**
 * Merges same-type scopes from tied rules.
 *
 * Union rather than intersection, deliberately: two rules that each recognised
 * part of "Sections A/G" must together produce {A, G}. Intersecting would drop
 * a section and hide the assignment from the students in it.
 */
function mergeScopes(
  scopes: readonly AssignmentSectionScope[],
  fallback: AssignmentSectionScope,
): AssignmentSectionScope {
  if (scopes.length === 1) return fallback;

  if (fallback.type === 'SPECIFIC_SECTIONS') {
    const sections = new Set<string>();
    for (const scope of scopes) {
      if (scope.type === 'SPECIFIC_SECTIONS') for (const section of scope.sections) sections.add(section);
    }
    return { type: 'SPECIFIC_SECTIONS', sections: [...sections] };
  }

  if (fallback.type === 'ALL_SECTIONS_EXCEPT') {
    // Intersection here, for the same reason: a section only stays excluded if
    // every tied rule agreed it was excluded.
    const lists = scopes
      .filter((scope) => scope.type === 'ALL_SECTIONS_EXCEPT')
      .map((scope) => new Set(scope.excluded));
    const first = lists[0];
    if (first === undefined) return fallback;
    const excluded = [...first].filter((section) => lists.every((list) => list.has(section)));
    return excluded.length === 0
      ? { type: 'ALL_SECTIONS' }
      : { type: 'ALL_SECTIONS_EXCEPT', excluded };
  }

  return fallback;
}
