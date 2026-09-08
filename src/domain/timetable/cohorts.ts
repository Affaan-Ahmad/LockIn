import type { CohortKind, TimetableDay } from './types';

/**
 * The choices to put in front of a student.
 *
 * A student cannot be asked "what is your intake year and programme code"
 * because the answer has to match the sheet's own vocabulary exactly, and the
 * sheet is the only place that vocabulary is written down. So the options are
 * read back out of the document: the legend supplies the cohorts, and the
 * classes supply the sections each cohort actually has.
 *
 * Nothing is inferred from the student's existing profile. The programme code
 * stored there belongs to a different naming scheme -- it feeds codes like
 * `BCS-4G`, where the digit is a semester, while the timetable's legend counts
 * in intake years. Mapping one to the other would be a guess, and a wrong guess
 * shows somebody an entire week that is not theirs.
 */

export interface CohortOption {
  /** Exactly as the sheet's legend writes it: `BS CS (2025)`. */
  readonly label: string;
  readonly programCode: string | null;
  readonly intakeYear: number | null;
  readonly kind: CohortKind;
  /**
   * Section letters this cohort is taught in, across the week. Laboratory
   * subgroups are folded back into their section: a student is in `F`, and the
   * sheet decides whether they sit in `F1` or `F2`.
   *
   * Empty for a cohort taught as one group. The taught masters programmes are
   * written that way -- `Blockchain (AI)` names a programme and no section --
   * and dropping them for having no sections would leave those students unable
   * to pick themselves at all.
   */
  readonly sections: readonly string[];
}

/**
 * Stands in for "this cohort is taught as one group" where a section is
 * expected. Section identifiers are a letter and at most one digit, so this can
 * never collide with a real one.
 */
export const WHOLE_COHORT_SECTION = 'ALL';

/** `F1` and `F2` are subgroups of section `F`; `M` and `B2` stand alone. */
const baseSection = (section: string): string =>
  /^[A-Z][0-9]$/.test(section) ? (section[0] ?? section) : section;

/**
 * Every cohort the week can show, with the sections it actually teaches.
 *
 * Ordered as a student would look for themselves: undergraduate intakes newest
 * first, then everything else. A cohort nothing was published against at all is
 * dropped, because offering it leads to an empty week with no explanation -- but
 * one taught as a single group is kept, with no sections to choose from.
 */
export function cohortOptions(days: readonly TimetableDay[]): readonly CohortOption[] {
  interface Accumulated {
    readonly option: Omit<CohortOption, 'sections'>;
    readonly sections: Set<string>;
    /** A class published to the whole programme, naming no section. */
    taughtAsOneGroup: boolean;
  }
  const byLabel = new Map<string, Accumulated>();

  for (const day of days) {
    for (const cohorts of day.legend.values()) {
      for (const cohort of cohorts) {
        // `Repeat Courses` and the elective bands are categories, not cohorts:
        // nobody *is* a repeat student. Their classes still reach the right
        // people, matched on the intake written inside each cell.
        if (cohort.kind === 'REPEAT' || cohort.kind === 'ELECTIVE' || cohort.kind === 'OTHER') {
          continue;
        }
        if (!byLabel.has(cohort.label)) {
          byLabel.set(cohort.label, {
            option: {
              label: cohort.label,
              programCode: cohort.programCode,
              intakeYear: cohort.intakeYear,
              kind: cohort.kind,
            },
            sections: new Set<string>(),
            taughtAsOneGroup: false,
          });
        }
      }
    }

    for (const entry of day.entries) {
      const cohort = entry.cohort;
      if (cohort === null) continue;
      const found = byLabel.get(cohort.label);
      if (found === undefined) continue;

      if (entry.wholeCohort) found.taughtAsOneGroup = true;
      for (const section of entry.sections) {
        // Only sections of the cohort's own programme. A combined cell such as
        // `Data St (AI/DS-A, 24)` names two, and each belongs to its own.
        if (cohort.programCode !== null && section.programCode !== cohort.programCode) continue;
        found.sections.add(baseSection(section.section));
      }
    }
  }

  return [...byLabel.values()]
    .filter((entry) => entry.sections.size > 0 || entry.taughtAsOneGroup)
    .map(({ option, sections }) => ({ ...option, sections: [...sections].sort() }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'UNDERGRADUATE' ? -1 : 1;
      if (a.intakeYear !== b.intakeYear) return (b.intakeYear ?? 0) - (a.intakeYear ?? 0);
      return a.label.localeCompare(b.label);
    });
}

/** The option matching a stored label, or null when it no longer exists. */
export function findCohort(
  options: readonly CohortOption[],
  label: string | null,
): CohortOption | null {
  if (label === null) return null;
  return options.find((option) => option.label === label) ?? null;
}
