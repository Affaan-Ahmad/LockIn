import type { LocatedMention, MentionField } from '../mentions-context';
import type { ScopeOutcome, SectionScopeRule } from '../scope';
import { ScopePriority } from '../scope';
import type { SectionMention } from '../section-mentions';

/**
 * Rules that recognise a university's way of *writing* section names.
 *
 * This is where variation is genuinely expected, so this is where the extension
 * point lives. A new convention -- a course that writes "G-morning", a teacher
 * who uses roman numerals -- is a new file next to these, registered in
 * `registry.ts`. Nothing here changes.
 *
 * Every rule below can only ever produce SPECIFIC_SECTIONS. None of them can
 * conclude "no restriction" (that is `noSectionRestrictionRule`'s job alone) and
 * none of them reasons about a student.
 */

interface NamingRuleSpec {
  readonly id: string;
  readonly priority: number;
  readonly field: MentionField;
  readonly confidence: number;
  readonly accepts: (mention: SectionMention) => boolean;
  readonly detail: string;
}

function buildNamingRule(spec: NamingRuleSpec): SectionScopeRule {
  return {
    id: spec.id,
    priority: spec.priority,

    evaluate(context): ScopeOutcome | null {
      const matches = context.mentions.all.filter(
        (entry) =>
          entry.field === spec.field &&
          entry.mention.strength === 'STRONG' &&
          !entry.mention.negated &&
          spec.accepts(entry.mention),
      );
      if (matches.length === 0) return null;

      // An unexpandable range in the deciding field means we found targeting we
      // cannot enumerate. Naming a partial set would silently drop sections.
      if (matches.some((entry) => entry.mention.unresolved)) {
        return {
          scope: {
            type: 'UNCERTAIN',
            reason: `Section range in the ${spec.field.toLowerCase()} could not be expanded`,
          },
          confidence: 0,
          evidence: matches.map((entry) => toEvidence(entry, 'Unexpandable section range')),
        };
      }

      const sections = [...new Set(matches.flatMap((entry) => [...entry.mention.sections]))];
      if (sections.length === 0) return null;

      return {
        scope: { type: 'SPECIFIC_SECTIONS', sections },
        confidence: spec.confidence,
        evidence: matches.map((entry) => toEvidence(entry, spec.detail)),
      };
    },
  };
}

function toEvidence(entry: LocatedMention, detail: string) {
  return { source: entry.field, matchedText: entry.mention.raw, detail };
}

const isKeywordScoped = (mention: SectionMention): boolean =>
  mention.keywordScoped && mention.sections.length > 0;

const isBareList = (mention: SectionMention): boolean =>
  !mention.keywordScoped &&
  (mention.kind === 'LIST' || mention.kind === 'RANGE' || mention.kind === 'BARE_LETTER');

const isProgramCode = (mention: SectionMention): boolean =>
  !mention.keywordScoped && mention.kind === 'PROGRAM_CODE';

/** "Assignment 3 - Section G", "Sections F/G", "Sec G". */
export const explicitSectionWordRule = buildNamingRule({
  id: 'EXPLICIT_SECTION_WORD',
  priority: ScopePriority.TITLE_EXPLICIT,
  field: 'TITLE',
  confidence: 0.95,
  accepts: isKeywordScoped,
  detail: 'Title names the targeted section(s) explicitly',
});

/**
 * "Assignment 3 - F/G", "Lab 2 - G and H", "Quiz (G)".
 *
 * No "section" keyword, so this leans entirely on the label position the
 * tokeniser required: set apart by punctuation, not floating in prose.
 */
export const sectionSlashListRule = buildNamingRule({
  id: 'SECTION_SLASH_LIST',
  priority: ScopePriority.TITLE_LIST,
  field: 'TITLE',
  confidence: 0.9,
  accepts: isBareList,
  detail: 'Title carries a labelled list of section identifiers',
});

/** "Assignment 3 - BCS-4G", "BCS4G", "4G". */
export const sectionAliasCodeRule = buildNamingRule({
  id: 'SECTION_ALIAS_CODE',
  priority: ScopePriority.TITLE_CODE,
  field: 'TITLE',
  confidence: 0.9,
  accepts: isProgramCode,
  detail: 'Title carries a program-batch-section code',
});

/**
 * The Classroom topic a post was filed under, e.g. a topic literally named
 * "Section G". Ranked below the title because a topic describes where the post
 * lives, not necessarily who it is for.
 */
export const topicSectionRule = buildNamingRule({
  id: 'TOPIC_SECTION',
  priority: ScopePriority.TOPIC,
  field: 'TOPIC',
  confidence: 0.9,
  accepts: (mention) => mention.sections.length > 0,
  detail: 'Classroom topic names the targeted section(s)',
});

/**
 * A section named in the body text.
 *
 * Restricted to keyword-scoped mentions and program codes. A bare letter in a
 * label position is convincing in a short title and meaningless in a paragraph,
 * so it is not accepted here.
 *
 * Confidence is 0.8 -- the lowest value the schema permits for a decision that
 * can hide coursework. Any weaker signal must not be able to hide anything.
 */
export const descriptionSectionRule = buildNamingRule({
  id: 'DESCRIPTION_SECTION',
  priority: ScopePriority.DESCRIPTION,
  field: 'DESCRIPTION',
  confidence: 0.8,
  accepts: (mention) => isKeywordScoped(mention) || isProgramCode(mention),
  detail: 'Description names the targeted section(s)',
});
