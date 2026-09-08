import type { TimetableEntry } from './types';

/**
 * Choosing which of a day's classes belong to one student.
 *
 * The bias here is deliberate and matches the rest of the product: showing a
 * class that is not yours wastes a moment, while hiding one that is yours makes
 * you miss it. So anything the sheet leaves genuinely open -- a lab split into
 * subgroups, an entry whose section could not be read but which carries your
 * cohort's colour -- is returned as POSSIBLE rather than dropped.
 *
 * The student's identity is a legend label they picked, not something inferred.
 * The sheet's cohorts are published in its own legend, so the honest way to ask
 * "which of these are you" is to show that list and let them answer.
 */

export interface StudentTimetableIdentity {
  /** A label taken verbatim from the sheet's legend, e.g. `BS CS (2025)`. */
  readonly cohortLabel: string;
  /** Programme code from that label, e.g. `CS`. */
  readonly programCode: string;
  /** Intake year from that label. Null for cohorts the legend gives no year. */
  readonly intakeYear: number | null;
  /** Section letter, e.g. `A`. Lab subgroups are matched from this. */
  readonly section: string;
}

export type MatchConfidence =
  /** The entry names this student's section, or their whole cohort. */
  | 'MATCH'
  /** Plausibly theirs: a lab subgroup, or their cohort's colour with no readable section. */
  | 'POSSIBLE';

export type MatchReason = 'SECTION' | 'LAB_SUBGROUP' | 'WHOLE_COHORT' | 'UNREADABLE_SECTION';

export interface TimetableMatch {
  readonly entry: TimetableEntry;
  readonly confidence: MatchConfidence;
  readonly reason: MatchReason;
}

/** `A` covers the lab subgroups `A1` and `A2`, but never section `B`. */
function isLabSubgroupOf(candidate: string, section: string): boolean {
  return candidate.length === section.length + 1 && candidate.startsWith(section)
    && /[0-9]/.test(candidate.slice(section.length));
}

/**
 * Does this entry belong to the student's cohort?
 *
 * Repeat courses are the exception worth naming: their colour says "repeat"
 * rather than naming an intake, so the intake is written inside the cell and
 * has to be read from there instead.
 */
function cohortMatches(entry: TimetableEntry, identity: StudentTimetableIdentity): boolean {
  const cohort = entry.cohort;
  if (cohort === null) return false;

  if (cohort.kind === 'REPEAT') {
    if (entry.intakeYearHint === null || entry.intakeYearHint !== identity.intakeYear) return false;
    return entry.sections.some((section) => section.programCode === identity.programCode);
  }

  // Electives are published across cohorts, so the section is what identifies them.
  if (cohort.kind === 'ELECTIVE') {
    return entry.sections.some((section) => section.programCode === identity.programCode);
  }

  if (cohort.label !== identity.cohortLabel) return false;
  // An intake written in the cell overrides the legend's, even for a normal cohort.
  return entry.intakeYearHint === null || entry.intakeYearHint === identity.intakeYear;
}

export function selectForStudent(
  entries: readonly TimetableEntry[],
  identity: StudentTimetableIdentity,
): readonly TimetableMatch[] {
  const matches: TimetableMatch[] = [];

  for (const entry of entries) {
    if (!cohortMatches(entry, identity)) continue;

    const named = entry.sections.filter((section) => section.programCode === identity.programCode);

    if (named.some((section) => section.section === identity.section)) {
      matches.push({ entry, confidence: 'MATCH', reason: 'SECTION' });
      continue;
    }

    if (named.some((section) => isLabSubgroupOf(section.section, identity.section))) {
      // Which subgroup a student is in is not published, so both are shown.
      matches.push({ entry, confidence: 'POSSIBLE', reason: 'LAB_SUBGROUP' });
      continue;
    }

    if (named.length > 0) continue; // Named other sections; not this student's.

    if (entry.wholeCohort) {
      matches.push({ entry, confidence: 'MATCH', reason: 'WHOLE_COHORT' });
      continue;
    }

    if (entry.status === 'UNCERTAIN') {
      // Their cohort's colour, but the section could not be read. Surfaced so
      // the student can judge from the sheet's own words.
      matches.push({ entry, confidence: 'POSSIBLE', reason: 'UNREADABLE_SECTION' });
    }
  }

  return matches;
}

/** Chronological, with timeless entries last so they cannot displace real ones. */
export function byStartTime(a: TimetableMatch, b: TimetableMatch): number {
  const left = a.entry.time?.startMinute ?? Number.POSITIVE_INFINITY;
  const right = b.entry.time?.startMinute ?? Number.POSITIVE_INFINITY;
  return left - right;
}
