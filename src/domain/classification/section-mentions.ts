import {
  expandSectionRange,
  isSectionIdentifier,
  normalizeAliasKey,
  parseCompoundSectionCode,
} from '@/domain/academic/section';

/**
 * Section-mention extraction.
 *
 * Substring matching is not sufficient and the failure modes are not academic:
 * "Group G", "Assignment G1", "Sections A-G" and "All sections except G" all
 * contain the letter G, and three of the four mean something other than
 * "section G". A student hidden from their own coursework by a naive
 * title.includes('G') misses a deadline.
 *
 * So the text is tokenised and parsed rather than searched. Every mention
 * carries what it is, how strongly we believe it, and the span it came from, so
 * the rules above can be conservative in a way that is explainable.
 */

export type SectionMentionKind =
  | 'UNIVERSAL'
  | 'UNIVERSAL_EXCEPT'
  | 'EXCLUSION'
  /**
   * A phrase that unmistakably talks about sections but does not say which:
   * "for the remaining sections", "your respective section". Section
   * information exists, so this is not an unrestricted assignment -- but we
   * cannot name the sections, so it must not become a targeting decision.
   */
  | 'AMBIGUOUS'
  | 'LABELLED'
  | 'LIST'
  | 'RANGE'
  | 'PROGRAM_CODE'
  | 'BARE_LETTER';

export type MentionStrength = 'STRONG' | 'WEAK';

export interface SectionMention {
  readonly kind: SectionMentionKind;
  readonly strength: MentionStrength;
  /** True when the mention is scoped by an exclusion cue ("except B"). */
  readonly negated: boolean;
  /** Bare section identifiers referred to, normalised: ['g'] or ['a','b','c']. */
  readonly sections: readonly string[];
  /** Every alias key this mention could match against a student's alias set. */
  readonly aliasKeys: ReadonlySet<string>;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  /** A range whose endpoints could not be expanded safely. Never used to exclude. */
  readonly unresolved: boolean;
  /** True when the word "section"/"sec" introduced the mention. */
  readonly keywordScoped: boolean;
}

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly isWord: boolean;
}

const SECTION_KEYWORDS = new Set(['section', 'sections', 'sec', 'secs', 'sect', 'sects']);

/** Qualifiers that make a section phrase mean "everyone". */
const UNIVERSAL_QUALIFIERS = new Set(['all', 'every', 'both']);

/**
 * Qualifiers that reference sections without naming them. The assignment is
 * clearly targeted at *something*, so treating it as unrestricted would be a
 * guess in the dangerous direction.
 */
const AMBIGUOUS_QUALIFIERS = new Set([
  'remaining',
  'other',
  'others',
  'respective',
  'relevant',
  'rest',
  'certain',
  'some',
  'few',
  'concerned',
  'specific',
  'your',
  'their',
  'its',
  'assigned',
  'designated',
  'applicable',
]);

/**
 * Words that turn a following letter into something that is not a section.
 * "Group G", "Part A" and "Question B" occur constantly in real coursework
 * titles, and every one of them would otherwise produce a false mention.
 */
const DENY_PREFIXES = new Set([
  'group',
  'groups',
  'page',
  'part',
  'parts',
  'question',
  'questions',
  'q',
  'task',
  'figure',
  'fig',
  'table',
  'appendix',
  'annex',
  'version',
  'option',
  'tier',
  'grade',
  'chapter',
  'week',
  'phase',
  'level',
  'set',
  'item',
  'step',
  'plan',
  'type',
  'category',
  'block',
  'slot',
  'team',
  'room',
  'batch',
  'exercise',
  'problem',
  'case',
  'variant',
]);

const NEGATION_CUES = new Set([
  'except',
  'excepting',
  'excluding',
  'excludes',
  'exclude',
  'excl',
  'besides',
]);

/** Filler that may sit between a negation cue and the section list. */
const NEGATION_FILLER = new Set([
  'for',
  'the',
  'than',
  'from',
  'of',
  'section',
  'sections',
  'sec',
  'secs',
]);

const SEPARATOR_PUNCT = new Set([',', '&', '/', '+', ';']);
const SEPARATOR_WORDS = new Set(['and', 'or']);
const RANGE_PUNCT = new Set(['-', '–', '—', '~']);
const RANGE_WORDS = new Set(['to', 'through', 'thru', 'till']);

/** Punctuation that can introduce a label, as in "Assignment 3 - G" or "Quiz (G)". */
const LABEL_OPEN = new Set(['-', '–', '—', ':', '(', '[', '{', '|', '#', '*', '/']);
/** Punctuation that can close one. */
const LABEL_CLOSE = new Set([
  '-',
  '–',
  '—',
  ':',
  ')',
  ']',
  '}',
  '|',
  '*',
  '/',
  ',',
  '.',
  '!',
  '(',
]);

const LIST_INTRO_PUNCT = new Set([':', '-', '–', '—', '#', '(', '.', '=']);

export function extractSectionMentions(input: string | null | undefined): SectionMention[] {
  if (input === null || input === undefined) return [];
  const text = input;
  if (text.trim() === '') return [];

  // ASCII-only lowering keeps indices aligned with the original string, which
  // String.prototype.toLowerCase does not guarantee for every code point.
  const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const tokens = tokenize(lower);
  if (tokens.length === 0) return [];

  const consumed = new Array<boolean>(tokens.length).fill(false);
  const mentions: SectionMention[] = [];

  collectQualifiedPhrases(tokens, text, consumed, mentions);
  collectNegated(tokens, text, consumed, mentions);
  collectKeywordScoped(tokens, text, consumed, mentions);
  collectCompoundCodes(tokens, text, consumed, mentions);
  collectBareLetters(tokens, text, consumed, mentions);

  return mentions.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Collection passes. Order matters: broader constructs claim their tokens first
// so that "all sections except G" is never re-read as a bare mention of G.
// ---------------------------------------------------------------------------

/**
 * Phrases of the form "<qualifier> section(s)".
 *
 * Splits into the two outcomes that matter. "all sections" means everyone and
 * is safe to act on. "the remaining sections" also proves the post is targeted,
 * but names nobody -- and reading that as unrestricted would show the item to
 * students it was never meant for, while reading it as any particular section
 * would hide it from students it was. Neither guess is acceptable, so it
 * becomes AMBIGUOUS and the assignment goes to review.
 */
function collectQualifiedPhrases(
  tokens: readonly Token[],
  text: string,
  consumed: boolean[],
  out: SectionMention[],
): void {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i] as Token;
    if (!token.isWord) continue;

    const universal = UNIVERSAL_QUALIFIERS.has(token.text);
    const ambiguous = AMBIGUOUS_QUALIFIERS.has(token.text);
    if (!universal && !ambiguous) continue;

    let cursor = i + 1;
    // "the rest of the sections", "all of the sections"
    for (let filler = 0; filler < 3; filler += 1) {
      const candidate = tokens[cursor];
      if (candidate?.isWord === true && (candidate.text === 'the' || candidate.text === 'of')) {
        cursor += 1;
        continue;
      }
      break;
    }

    const keyword = tokens[cursor];
    if (keyword?.isWord !== true || !SECTION_KEYWORDS.has(keyword.text)) continue;

    if (ambiguous) {
      markConsumed(consumed, i, cursor);
      out.push(
        buildMention({
          kind: 'AMBIGUOUS',
          strength: 'STRONG',
          negated: false,
          sections: [],
          unresolved: true,
          keywordScoped: true,
          tokens,
          text,
          fromIndex: i,
          toIndex: cursor,
        }),
      );
      continue;
    }

    // "all sections" followed by an exclusion is not universal -- it is a
    // universal with a carve-out, and the carve-out is the important half.
    const cue = findNegationCueAhead(tokens, cursor + 1, 2);
    if (cue !== null) {
      const list = parseSectionList(tokens, skipNegationFiller(tokens, cue + 1));
      if (list !== null) {
        markConsumed(consumed, i, list.endIndex);
        out.push(
          buildMention({
            kind: 'UNIVERSAL_EXCEPT',
            strength: list.unresolved ? 'WEAK' : 'STRONG',
            negated: true,
            keywordScoped: true,
            sections: list.sections,
            unresolved: list.unresolved,
            tokens,
            text,
            fromIndex: i,
            toIndex: list.endIndex,
          }),
        );
        continue;
      }
      // Cue present but no parseable list: refuse to read this as universal.
      markConsumed(consumed, i, cue);
      out.push(
        buildMention({
          kind: 'EXCLUSION',
          strength: 'WEAK',
          negated: true,
          sections: [],
          unresolved: true,
          tokens,
          text,
          fromIndex: i,
          toIndex: cue,
        }),
      );
      continue;
    }

    markConsumed(consumed, i, cursor);
    out.push(
      buildMention({
        kind: 'UNIVERSAL',
        strength: 'STRONG',
        negated: false,
        keywordScoped: true,
        sections: [],
        unresolved: false,
        tokens,
        text,
        fromIndex: i,
        toIndex: cursor,
      }),
    );
  }
}

function collectNegated(
  tokens: readonly Token[],
  text: string,
  consumed: boolean[],
  out: SectionMention[],
): void {
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i] === true) continue;
    const token = tokens[i] as Token;
    if (!token.isWord) continue;

    const cueEnd = negationCueEndingAt(tokens, i);
    if (cueEnd === null) continue;

    const list = parseSectionList(tokens, skipNegationFiller(tokens, cueEnd + 1));
    if (list === null) continue;
    if (rangeOverlapsConsumed(consumed, i, list.endIndex)) continue;

    markConsumed(consumed, i, list.endIndex);
    out.push(
      buildMention({
        kind: 'EXCLUSION',
        strength: 'STRONG',
        negated: true,
        sections: list.sections,
        unresolved: list.unresolved,
        tokens,
        text,
        fromIndex: i,
        toIndex: list.endIndex,
      }),
    );
  }
}

function collectKeywordScoped(
  tokens: readonly Token[],
  text: string,
  consumed: boolean[],
  out: SectionMention[],
): void {
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i] === true) continue;
    const token = tokens[i] as Token;
    if (!token.isWord || !SECTION_KEYWORDS.has(token.text)) continue;
    if (isDeniedByPrefix(tokens, i)) continue;

    const list = parseSectionList(tokens, i + 1);
    if (list === null) continue;
    if (rangeOverlapsConsumed(consumed, i, list.endIndex)) continue;

    markConsumed(consumed, i, list.endIndex);
    out.push(
      buildMention({
        kind: list.kind,
        // An unresolved range is explicit enough to notice but not precise
        // enough to act on, so it is downgraded rather than dropped.
        strength: list.unresolved ? 'WEAK' : 'STRONG',
        negated: false,
        keywordScoped: true,
        sections: list.sections,
        unresolved: list.unresolved,
        tokens,
        text,
        fromIndex: i,
        toIndex: list.endIndex,
      }),
    );
  }
}

function collectCompoundCodes(
  tokens: readonly Token[],
  text: string,
  consumed: boolean[],
  out: SectionMention[],
): void {
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i] === true) continue;
    const token = tokens[i] as Token;
    if (!token.isWord) continue;
    if (isDeniedByPrefix(tokens, i)) continue;

    const joined = readCompoundCode(tokens, i);
    if (joined === null) continue;
    if (rangeOverlapsConsumed(consumed, i, joined.endIndex)) continue;

    markConsumed(consumed, i, joined.endIndex);
    out.push(
      buildMention({
        kind: 'PROGRAM_CODE',
        // A bare batch-section like "4G" is one keystroke away from "Q4a", so it
        // only counts as strong evidence when it sits in a label position.
        strength:
          joined.hasProgramPrefix || isLabelPosition(tokens, i, joined.endIndex)
            ? 'STRONG'
            : 'WEAK',
        negated: false,
        sections: [joined.section],
        unresolved: false,
        tokens,
        text,
        fromIndex: i,
        toIndex: joined.endIndex,
      }),
    );
  }
}

function collectBareLetters(
  tokens: readonly Token[],
  text: string,
  consumed: boolean[],
  out: SectionMention[],
): void {
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed[i] === true) continue;
    const token = tokens[i] as Token;
    if (!token.isWord || token.text.length !== 1 || !/^[a-z]$/.test(token.text)) continue;
    if (isDeniedByPrefix(tokens, i)) continue;

    const list = parseSectionList(tokens, i, { requireImmediate: true });
    if (list === null) continue;
    if (!isLabelPosition(tokens, i, list.endIndex)) continue;
    if (rangeOverlapsConsumed(consumed, i, list.endIndex)) continue;

    const kind: SectionMentionKind = list.kind === 'LABELLED' ? 'BARE_LETTER' : list.kind;

    markConsumed(consumed, i, list.endIndex);
    out.push(
      buildMention({
        kind,
        strength:
          list.unresolved || isEnumerationMarker(tokens, i, list.endIndex) ? 'WEAK' : 'STRONG',
        negated: false,
        sections: list.sections,
        unresolved: list.unresolved,
        tokens,
        text,
        fromIndex: i,
        toIndex: list.endIndex,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface ParsedList {
  readonly sections: string[];
  readonly kind: 'LABELLED' | 'LIST' | 'RANGE';
  readonly endIndex: number;
  readonly unresolved: boolean;
}

/**
 * Parses "A", "A, B and C", "A-G", "BCS-4G" starting at `start`.
 * Returns null when the tokens are not a section list, which is the common case
 * and must stay cheap.
 */
function parseSectionList(
  tokens: readonly Token[],
  start: number,
  options: { requireImmediate?: boolean } = {},
): ParsedList | null {
  let cursor = start;

  if (options.requireImmediate !== true) {
    const intro = tokens[cursor];
    if (intro !== undefined && !intro.isWord && LIST_INTRO_PUNCT.has(intro.text)) cursor += 1;
  }

  const first = readSectionToken(tokens, cursor);
  if (first === null) return null;

  const sections: string[] = [first.section];
  let kind: ParsedList['kind'] = 'LABELLED';
  let unresolved = false;
  let endIndex = first.endIndex;
  cursor = first.endIndex + 1;

  for (;;) {
    const token = tokens[cursor];
    if (token === undefined) break;

    const isRangeMarker =
      (!token.isWord && RANGE_PUNCT.has(token.text)) ||
      (token.isWord && RANGE_WORDS.has(token.text));
    const isSeparator =
      (!token.isWord && SEPARATOR_PUNCT.has(token.text)) ||
      (token.isWord && SEPARATOR_WORDS.has(token.text));

    if (!isRangeMarker && !isSeparator) break;

    const next = readSectionToken(tokens, cursor + 1);
    if (next === null) break;

    if (isRangeMarker) {
      const from = sections[sections.length - 1] as string;
      const expanded = expandSectionRange(from, next.section);
      if (expanded === null) {
        // "A-G" we can expand; "A2-B1" or a reversed range we cannot. Record the
        // endpoints and flag it so no rule treats this as precise targeting.
        sections.push(next.section);
        unresolved = true;
      } else {
        sections.splice(sections.length - 1, 1, ...expanded);
      }
      kind = kind === 'LIST' ? 'LIST' : 'RANGE';
    } else {
      sections.push(next.section);
      kind = 'LIST';
    }

    endIndex = next.endIndex;
    cursor = next.endIndex + 1;
  }

  return { sections: dedupe(sections), kind, endIndex, unresolved };
}

interface ReadSection {
  readonly section: string;
  readonly endIndex: number;
}

function readSectionToken(tokens: readonly Token[], index: number): ReadSection | null {
  const token = tokens[index];
  if (token === undefined || !token.isWord) return null;

  const compound = readCompoundCode(tokens, index);
  if (compound !== null) return { section: compound.section, endIndex: compound.endIndex };

  if (isSectionIdentifier(token.text)) return { section: token.text, endIndex: index };

  return null;
}

interface CompoundCode {
  readonly section: string;
  readonly endIndex: number;
  readonly hasProgramPrefix: boolean;
}

/** Reads "BCS4G", "BCS-4G", "BCS 4G" and "4G" from the token stream. */
function readCompoundCode(tokens: readonly Token[], index: number): CompoundCode | null {
  const token = tokens[index];
  if (token === undefined || !token.isWord) return null;

  const direct = parseCompoundSectionCode(token.text);
  if (direct !== null) {
    return {
      section: direct.section,
      endIndex: index,
      hasProgramPrefix: direct.programCode !== null,
    };
  }

  if (!/^[a-z]{2,6}$/.test(token.text)) return null;

  let cursor = index + 1;
  const maybeSeparator = tokens[cursor];
  if (
    maybeSeparator !== undefined &&
    !maybeSeparator.isWord &&
    RANGE_PUNCT.has(maybeSeparator.text)
  ) {
    cursor += 1;
  }
  const tail = tokens[cursor];
  if (tail === undefined || !tail.isWord) return null;

  const parsed = parseCompoundSectionCode(`${token.text}${tail.text}`);
  if (parsed === null || parsed.programCode === null) return null;

  return { section: parsed.section, endIndex: cursor, hasProgramPrefix: true };
}

/** Index of the final token of a negation cue starting at `index`, or null. */
function negationCueEndingAt(tokens: readonly Token[], index: number): number | null {
  const token = tokens[index];
  if (token === undefined || !token.isWord) return null;
  if (NEGATION_CUES.has(token.text)) return index;
  const next = tokens[index + 1];
  if (next?.isWord !== true) return null;
  if (token.text === 'not' && next.text === 'for') return index + 1;
  if (token.text === 'other' && next.text === 'than') return index + 1;
  if (token.text === 'apart' && next.text === 'from') return index + 1;
  return null;
}

function findNegationCueAhead(
  tokens: readonly Token[],
  start: number,
  lookahead: number,
): number | null {
  for (let i = start; i < Math.min(tokens.length, start + lookahead + 1); i += 1) {
    const end = negationCueEndingAt(tokens, i);
    if (end !== null) return end;
  }
  return null;
}

function skipNegationFiller(tokens: readonly Token[], start: number): number {
  let cursor = start;
  for (let guard = 0; guard < 3; guard += 1) {
    const token = tokens[cursor];
    if (token === undefined) break;
    if (token.isWord && NEGATION_FILLER.has(token.text)) {
      cursor += 1;
      continue;
    }
    if (!token.isWord && LIST_INTRO_PUNCT.has(token.text)) {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

/**
 * A single letter only counts when punctuation sets it apart, which is how
 * teachers actually write it: "Assignment 3 - G", "Quiz (G)". Prose such as
 * "this is a quiz" or "Assignment G is due" fails this test and produces no
 * mention at all -- deliberately under-detecting, because a missed mention
 * degrades to "shown anyway" while a false one can hide real work.
 */
function isLabelPosition(tokens: readonly Token[], fromIndex: number, toIndex: number): boolean {
  const before = tokens[fromIndex - 1];
  const after = tokens[toIndex + 1];
  const openOk = before === undefined || (!before.isWord && LABEL_OPEN.has(before.text));
  const closeOk = after === undefined || (!after.isWord && LABEL_CLOSE.has(after.text));
  return openOk && closeOk;
}

/** "a) Introduction" is an enumeration marker, not section A. */
function isEnumerationMarker(
  tokens: readonly Token[],
  fromIndex: number,
  toIndex: number,
): boolean {
  if (fromIndex !== 0) return false;
  const after = tokens[toIndex + 1];
  if (after === undefined || after.isWord) return false;
  if (after.text !== ')' && after.text !== '.') return false;
  return tokens[toIndex + 2] !== undefined;
}

function isDeniedByPrefix(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous === undefined || !previous.isWord) return false;
  return DENY_PREFIXES.has(previous.text);
}

function markConsumed(consumed: boolean[], from: number, to: number): void {
  for (let i = from; i <= to; i += 1) consumed[i] = true;
}

function rangeOverlapsConsumed(consumed: readonly boolean[], from: number, to: number): boolean {
  for (let i = from; i <= to; i += 1) if (consumed[i] === true) return true;
  return false;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

interface BuildMentionInput {
  readonly kind: SectionMentionKind;
  readonly strength: MentionStrength;
  readonly negated: boolean;
  readonly sections: readonly string[];
  readonly unresolved: boolean;
  readonly tokens: readonly Token[];
  readonly text: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly keywordScoped?: boolean;
}

function buildMention(input: BuildMentionInput): SectionMention {
  const start = (input.tokens[input.fromIndex] as Token).start;
  const end = (input.tokens[input.toIndex] as Token).end;
  const raw = input.text.slice(start, end);

  const aliasKeys = new Set<string>();
  // A negated mention names sections the item is *not* for, so its span must
  // never be offered as something the student's alias could match positively.
  if (!input.negated) {
    const rawKey = normalizeAliasKey(raw);
    if (rawKey !== '') aliasKeys.add(rawKey);
    for (const section of input.sections) aliasKeys.add(section);
  }

  return {
    kind: input.kind,
    strength: input.strength,
    negated: input.negated,
    sections: input.sections,
    aliasKeys,
    raw,
    start,
    end,
    unresolved: input.unresolved,
    keywordScoped: input.keywordScoped ?? false,
  };
}

function tokenize(lower: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < lower.length) {
    const char = lower[i] as string;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/[a-z0-9]/.test(char)) {
      const start = i;
      while (i < lower.length && /[a-z0-9]/.test(lower[i] as string)) i += 1;
      tokens.push({ text: lower.slice(start, i), start, end: i, isWord: true });
      continue;
    }
    tokens.push({ text: char, start: i, end: i + 1, isWord: false });
    i += 1;
  }
  return tokens;
}
