import type { LocatedMention } from '../mentions-context';
import { hasSectionEvidence } from '../mentions-context';
import type { ScopeEvidence, SectionScopeRule } from '../scope';
import { ScopePriority } from '../scope';

/**
 * Rules that read the *shape* of a section phrase rather than the sections in
 * it: "all sections", "all sections except B", "for the remaining sections".
 *
 * They sit above the naming-convention rules because the shape decides how any
 * section names inside should be read. "all sections except G" contains the
 * letter G, and a rule that only looked for section names would conclude the
 * opposite of what the teacher wrote.
 */

function evidenceFrom(entry: LocatedMention, detail: string): ScopeEvidence {
  return { source: entry.field, matchedText: entry.mention.raw, detail };
}

/**
 * "for the remaining sections", "your respective section".
 *
 * Section targeting demonstrably exists, and we cannot name it. Both available
 * guesses are wrong in a way that costs something: reading it as unrestricted
 * shows the item to students it excludes, reading it as any particular section
 * hides it from students it includes. UNCERTAIN keeps it visible and flagged.
 */
export const ambiguousSectionPhraseRule: SectionScopeRule = {
  id: 'AMBIGUOUS_SECTION_PHRASE',
  priority: ScopePriority.AMBIGUOUS,

  evaluate(context) {
    const ambiguous = context.mentions.all.filter(
      (entry) => entry.mention.kind === 'AMBIGUOUS',
    );

    // A bare exclusion ("not for B") says who it is *not* for and nothing about
    // who it is for, unless an affirmative section list appears alongside it.
    const bareExclusions = context.mentions.all.filter(
      (entry) => entry.mention.kind === 'EXCLUSION' && entry.mention.negated,
    );
    const hasAffirmativeList = context.mentions.all.some(
      (entry) =>
        !entry.mention.negated &&
        entry.mention.strength === 'STRONG' &&
        entry.mention.sections.length > 0,
    );

    // A keyword-scoped mention we could not resolve -- an unexpandable range,
    // most often -- is targeting we failed to read, not an absence of targeting.
    const unresolvedTargeting = hasAffirmativeList
      ? []
      : context.mentions.all.filter(
          (entry) => entry.mention.keywordScoped && entry.mention.unresolved,
        );

    const relevant = [
      ...ambiguous,
      ...(hasAffirmativeList ? [] : bareExclusions),
      ...unresolvedTargeting,
    ];
    if (relevant.length === 0) return null;

    const first = relevant[0] as LocatedMention;

    return {
      scope: {
        type: 'UNCERTAIN',
        reason:
          first.mention.kind === 'AMBIGUOUS'
            ? `Section targeting is referenced but not named ("${first.mention.raw.trim()}")`
            : first.mention.kind === 'EXCLUSION'
              ? `Coursework excludes sections without stating who it is for ("${first.mention.raw.trim()}")`
              : `Section targeting could not be resolved ("${first.mention.raw.trim()}")`,
      },
      confidence: 0,
      evidence: relevant.map((entry) =>
        evidenceFrom(entry, 'Section targeting present but not resolvable'),
      ),
    };
  },
};

/**
 * "all sections except B".
 *
 * Expressed as ALL_SECTIONS_EXCEPT rather than as a SPECIFIC list, because we
 * do not know the full set of sections in the course and inventing one would be
 * manufacturing data. The carve-out form says exactly what the teacher said.
 */
export const universalExceptRule: SectionScopeRule = {
  id: 'UNIVERSAL_EXCEPT',
  priority: ScopePriority.UNIVERSAL_EXCEPT,

  evaluate(context) {
    const carveOuts = context.mentions.all.filter(
      (entry) => entry.mention.kind === 'UNIVERSAL_EXCEPT',
    );
    if (carveOuts.length === 0) return null;

    const excluded = [...new Set(carveOuts.flatMap((entry) => [...entry.mention.sections]))];
    const unresolved = carveOuts.some((entry) => entry.mention.unresolved);

    if (unresolved || excluded.length === 0) {
      return {
        scope: {
          type: 'UNCERTAIN',
          reason: 'Coursework carves out sections that could not be parsed with confidence',
        },
        confidence: 0,
        evidence: carveOuts.map((entry) => evidenceFrom(entry, 'Unparseable carve-out')),
      };
    }

    return {
      scope: { type: 'ALL_SECTIONS_EXCEPT', excluded },
      confidence: 0.95,
      evidence: carveOuts.map((entry) =>
        evidenceFrom(entry, `Addressed to all sections except ${excluded.join(', ')}`),
      ),
    };
  },
};

/** "Quiz 1 - all sections". Stated outright, so confidence is total. */
export const universalScopeRule: SectionScopeRule = {
  id: 'EXPLICIT_ALL_SECTIONS',
  priority: ScopePriority.UNIVERSAL,

  evaluate(context) {
    const universal = context.mentions.all.filter((entry) => entry.mention.kind === 'UNIVERSAL');
    if (universal.length === 0) return null;

    return {
      scope: { type: 'ALL_SECTIONS' },
      confidence: 1,
      evidence: universal.map((entry) =>
        evidenceFrom(entry, 'Explicitly addressed to every section'),
      ),
    };
  },
};

/**
 * The default, and the most important rule in the file.
 *
 * At this university a teacher labels a post only when it is section-specific.
 * An unlabelled post is for everyone, so absence of a section name means
 * ALL_SECTIONS -- not UNCERTAIN, and emphatically not NOT_RELEVANT.
 *
 * Confidence is 1 because this is not a hedge: we checked the title, the topic
 * and the description and found no restriction. That is a positive finding
 * about the assignment, not a failure to decide.
 *
 * What counts as evidence is `hasSectionEvidence`: a strong mention, or any
 * mention the word "section" introduced. Weak noise -- a stray "4g" in prose,
 * an "a)" enumeration marker -- does not, because letting it suppress this rule
 * would route ordinary coursework into the review queue.
 */
export const noSectionRestrictionRule: SectionScopeRule = {
  id: 'NO_SECTION_RESTRICTION_FOUND',
  priority: ScopePriority.DEFAULT,

  evaluate(context) {
    if (hasSectionEvidence(context.mentions)) return null;

    return {
      scope: { type: 'ALL_SECTIONS' },
      confidence: 1,
      evidence: [],
    };
  },
};
