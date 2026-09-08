import { isSectionIdentifier, normalizeAliasKey } from '@/domain/academic/section';

import {
  EXTENDED_UNTIL_PATTERN,
  TIME_RANGE_PATTERN,
  parseExtendedUntil,
  parseTimeRange,
} from './time-of-day';
import type { MinuteOfDay, SectionRef, TimeRange } from './types';

/**
 * Parsing of one segment of a timetable cell.
 *
 * A segment reads like `OOP (CS-A)`, and around that spine the sheet's authors
 * have added, over a semester of edits: explicit times that override the column
 * (`Pak Studies (CS-E) 11:30-01:15`), extensions (`Extended till 02:00`),
 * intakes for repeat courses (`PF (CS-A, 25)`), elective groups (`Big Data
 * (CS-B, G-I)`), combined programmes (`Data St (AI/DS-A, 24)`), combined
 * sections (`OOP Lab (CY-A/B/C)`), venue overrides (`SPM (SE-A) Audi (G-Flr,
 * Blk-D)`), qualifiers (`Functional English (AI-M) International Students`),
 * one-off dates (`Web (CS-A) on for May 04`), cancellations, and at least one
 * unbalanced bracket (`PPIT SE-F)`).
 *
 * The rule that keeps this honest is that **only the first parenthetical is
 * ever read as a section**. Everything after it is kept verbatim as a note. If
 * that first parenthetical does not parse as a section specification, the
 * segment yields no sections at all rather than a plausible-looking guess --
 * `Audi (G-Flr, Blk-D)` must never become "section G".
 */

/** `MS-DS` is a degree and a programme, not a programme and a section. */
const DEGREE_TOKENS = new Set(['BS', 'MS', 'PHD']);
/** A programme code as the sheet writes it: `CS`, `DS`, `AI`, `CY`, `SE`, `MS`. */
const PROGRAMME_TOKEN = /^[A-Za-z]{2,4}$/;
/** Elective grouping written beside a section: `G-I`, `G-II`, `G-III`. */
const GROUP_TOKEN = /^G-[IVXLC]+$/i;
/** A two- or four-digit intake: `25`, `2025`. */
const INTAKE_TOKEN = /^(?:\d{2}|(?:19|20)\d{2})$/;
const CANCELLED = /\bcancell?ed\b/i;

export interface ParsedSegment {
  /** Text before the section specification, e.g. `OOP`. Never expanded. */
  readonly courseLabel: string;
  readonly sections: readonly SectionRef[];
  /** Programme codes named by the specification, uppercased. */
  readonly programCodes: readonly string[];
  /** The specification named a programme but no section: everyone in it attends. */
  readonly wholeCohort: boolean;
  /** False when the first parenthetical was absent or unreadable as a section. */
  readonly hasSectionSpec: boolean;
  readonly intakeYearHint: number | null;
  readonly groups: readonly string[];
  readonly time: TimeRange | null;
  readonly extendedUntilMinute: MinuteOfDay | null;
  readonly cancelled: boolean;
  readonly notes: readonly string[];
  readonly raw: string;
}

interface Parenthetical {
  readonly inner: string;
  readonly start: number;
  readonly end: number;
}

/** Locates the first balanced `(...)`, so a nested venue bracket cannot end it early. */
function findFirstParenthetical(text: string): Parenthetical | null {
  const start = text.indexOf('(');
  if (start === -1) return null;

  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return { inner: text.slice(start + 1, index), start, end: index + 1 };
      }
    }
  }
  return null;
}

interface SectionSpec {
  readonly sections: readonly SectionRef[];
  readonly programCodes: readonly string[];
  readonly wholeCohort: boolean;
  readonly intakeYearHint: number | null;
  readonly groups: readonly string[];
  readonly notes: readonly string[];
}

/**
 * Reads the contents of the first parenthetical as a section specification.
 *
 * The head item carries the programme and section; later comma-separated items
 * carry an intake or an elective group. Returns null when the head item is not
 * a specification at all, which is what stops venues and stray brackets being
 * read as sections.
 */
export function parseSectionSpec(inner: string): SectionSpec | null {
  const items = inner
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const head = items[0];
  if (head === undefined) return null;

  const [left, right, ...rest] = head.split('-');
  if (left === undefined || rest.length > 0) return null;

  const programCodes: string[] = [];
  const sections: SectionRef[] = [];

  if (right === undefined) {
    // A bare programme: `Blockchain (AI)`, `Adv Agentic AI (PhD)`.
    if (!PROGRAMME_TOKEN.test(left)) return null;
    programCodes.push(left.toUpperCase());
  } else if (DEGREE_TOKENS.has(left.toUpperCase())) {
    // `MS-DS` is the MS Data Science cohort, which has no sections of its own.
    if (!PROGRAMME_TOKEN.test(right)) return null;
    programCodes.push(right.toUpperCase());
  } else {
    const leftTokens = left.split('/');
    const rightTokens = right.split('/');
    if (!leftTokens.every((token) => PROGRAMME_TOKEN.test(token))) return null;
    // Every right-hand token must be a section identifier. One failure rejects
    // the whole specification, because a partial read here would attach a real
    // class to a section that was never written.
    if (!rightTokens.every((token) => isSectionIdentifier(token))) return null;

    for (const programme of leftTokens) {
      const code = programme.toUpperCase();
      programCodes.push(code);
      for (const token of rightTokens) {
        const raw = `${code}-${token.toUpperCase()}`;
        sections.push({
          programCode: code,
          section: token.toUpperCase(),
          raw,
          key: normalizeAliasKey(raw),
        });
      }
    }
  }

  let intakeYearHint: number | null = null;
  const groups: string[] = [];
  const notes: string[] = [];

  for (const item of items.slice(1)) {
    if (INTAKE_TOKEN.test(item)) {
      const value = Number.parseInt(item, 10);
      intakeYearHint = item.length === 2 ? 2000 + value : value;
    } else if (GROUP_TOKEN.test(item)) {
      groups.push(item.toUpperCase());
    } else {
      notes.push(item);
    }
  }

  return {
    sections,
    programCodes,
    wholeCohort: sections.length === 0,
    intakeYearHint,
    groups,
    notes,
  };
}

/** Trims separators left behind after times and keywords are lifted out of a note. */
function tidyNote(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.–—-]+/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
}

export function parseCellSegment(segment: string): ParsedSegment {
  const raw = segment.replace(/\s+/g, ' ').trim();
  const parenthetical = findFirstParenthetical(raw);
  const spec = parenthetical === null ? null : parseSectionSpec(parenthetical.inner);

  // With no readable specification the segment stays whole: the caller decides
  // whether it is an unmodellable class or a continuation of the one above it.
  const courseLabel =
    spec === null || parenthetical === null ? raw : raw.slice(0, parenthetical.start).trim();
  const remainder = spec === null || parenthetical === null ? '' : raw.slice(parenthetical.end);

  // Times are read from the remainder only. A range before the section would be
  // part of the course's own name, and no course in this sheet has one.
  const time = parseTimeRange(remainder);
  const extendedUntilMinute = parseExtendedUntil(remainder);
  const cancelled = CANCELLED.test(raw);

  const leftover = tidyNote(
    remainder
      .replace(TIME_RANGE_PATTERN, ' ')
      .replace(EXTENDED_UNTIL_PATTERN, ' ')
      .replace(CANCELLED, ' '),
  );

  const notes = [...(spec?.notes ?? []), ...(leftover === '' ? [] : [leftover])];

  return {
    courseLabel,
    sections: spec?.sections ?? [],
    programCodes: spec?.programCodes ?? [],
    wholeCohort: spec?.wholeCohort ?? false,
    hasSectionSpec: spec !== null,
    intakeYearHint: spec?.intakeYearHint ?? null,
    groups: spec?.groups ?? [],
    time,
    extendedUntilMinute,
    cancelled,
    notes,
    raw,
  };
}
