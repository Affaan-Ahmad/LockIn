import { extractSectionMentions, type SectionMention } from './section-mentions';

/**
 * Tokenised section mentions for one coursework item, grouped by the field they
 * came from.
 *
 * Built once per item by the scope resolver and shared by every rule, so adding
 * rules stays free: ten rules cost one tokenisation, not ten.
 */

export type MentionField = 'TITLE' | 'DESCRIPTION' | 'TOPIC';

export interface LocatedMention {
  readonly field: MentionField;
  readonly mention: SectionMention;
}

export interface ItemMentions {
  readonly title: readonly SectionMention[];
  readonly description: readonly SectionMention[];
  readonly topic: readonly SectionMention[];
  readonly all: readonly LocatedMention[];
}

export function buildItemMentions(input: {
  title: string;
  description: string | null;
  topicName: string | null;
}): ItemMentions {
  const title = extractSectionMentions(input.title);
  const description = extractSectionMentions(input.description);
  const topic = extractSectionMentions(input.topicName);

  return {
    title,
    description,
    topic,
    all: [
      ...title.map((mention) => ({ field: 'TITLE' as const, mention })),
      ...topic.map((mention) => ({ field: 'TOPIC' as const, mention })),
      ...description.map((mention) => ({ field: 'DESCRIPTION' as const, mention })),
    ],
    };
}

/**
 * Whether the item carries section information at all.
 *
 * Two things count. A STRONG mention is targeting we can read. A keyword-scoped
 * mention counts even when it is weak -- "Sections G-A" is unmistakably about
 * sections, and the only reason it is weak is that we could not expand the
 * range. Declaring that assignment unrestricted would answer a question we
 * failed to understand.
 *
 * Everything else is noise and deliberately does not count: a stray "4g" in
 * prose, an "a)" enumeration marker. Letting those suppress the unrestricted
 * default would push ordinary coursework into the review queue, and a queue
 * full of ordinary coursework is a queue nobody reads.
 */
export function hasSectionEvidence(mentions: ItemMentions): boolean {
  return mentions.all.some(
    (entry) => entry.mention.strength === 'STRONG' || entry.mention.keywordScoped,
    );
}
