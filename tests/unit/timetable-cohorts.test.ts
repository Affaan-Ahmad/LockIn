import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cohortOptions, findCohort, WHOLE_COHORT_SECTION } from '@/domain/timetable/cohorts';
import { parseTimetableDay } from '@/domain/timetable/parse-day';
import { selectForStudent } from '@/domain/timetable/select';
import { isSectionIdentifier } from '@/domain/academic/section';
import type { TimetableDay, Weekday } from '@/domain/timetable/types';

/**
 * The list a student picks themselves from.
 *
 * Everything offered has to come out of the published document, because the
 * sheet's vocabulary is the only one that matches the sheet. The failure this
 * guards against is subtle: an option that looks reasonable but produces an
 * empty week, or one that is not a cohort anybody belongs to.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/timetable/${name}.html`, import.meta.url)), 'utf8');

const DAYS: ReadonlyArray<readonly [file: string, weekday: Weekday]> = [
  ['monday', 'MONDAY'],
  ['tuesday', 'TUESDAY'],
  ['wednesday', 'WEDNESDAY'],
  ['thursday', 'THURSDAY'],
  ['friday', 'FRIDAY'],
];

const week: readonly TimetableDay[] = DAYS.map(([file, weekday]) =>
  parseTimetableDay(fixture(file), weekday),
);
const options = cohortOptions(week);

describe('the cohorts on offer', () => {
  it('lists every undergraduate programme and intake the sheet publishes', () => {
    const labels = options.map((option) => option.label);

    for (const expected of ['BS CS (2025)', 'BS CS (2024)', 'BS SE (2022)', 'BS DS (2023)']) {
      expect(labels).toContain(expected);
    }
    expect(options.length).toBeGreaterThanOrEqual(20);
  });

  /**
   * `Repeat Courses` and the elective bands are colours in the legend, not
   * groups anybody is a member of. A student picking "Repeat Courses" as their
   * programme would be nonsense -- and they still get their own repeat classes,
   * matched on the intake written inside each cell.
   */
  it('does not offer a category as though it were a cohort', () => {
    const labels = options.map((option) => option.label);

    expect(labels).not.toContain('Repeat Courses');
    expect(labels).not.toContain('Elective Courses');
    expect(labels).not.toContain('MS Electives (All Prgrms)');
    for (const option of options) {
      expect(['UNDERGRADUATE', 'POSTGRADUATE']).toContain(option.kind);
    }
  });

  /**
   * The taught masters programmes publish classes like `Blockchain (AI)` --
   * a programme and no section. Requiring a section would have dropped them
   * from the list entirely, leaving those students unable to pick themselves.
   */
  it('keeps a cohort that is taught as one group, with no sections', () => {
    const masters = options.find((option) => option.label === 'MS (AI)');

    expect(masters).toBeDefined();
    expect(masters?.kind).toBe('POSTGRADUATE');
    expect(masters?.sections).toEqual([]);
  });

  it('folds laboratory subgroups back into their section', () => {
    const firstYear = options.find((option) => option.label === 'BS CS (2025)');

    // The sheet splits section F into F1 and F2 for laboratories; a student is
    // in F and does not know which.
    expect(firstYear?.sections).toContain('F');
    expect(firstYear?.sections).not.toContain('F1');
    expect(firstYear?.sections).not.toContain('F2');
  });

  it('gives a cohort only sections of its own programme', () => {
    // `Data St (AI/DS-A, 24)` names a section in two programmes at once.
    const ai = options.find((option) => option.label === 'BS AI (2024)');
    const ds = options.find((option) => option.label === 'BS DS (2024)');

    expect(ai?.sections).toContain('A');
    expect(ds?.sections).toContain('A');
    for (const option of options) {
      for (const section of option.sections) {
        expect(isSectionIdentifier(section)).toBe(true);
      }
    }
  });

  it('orders undergraduates first and newest intake first', () => {
    const undergraduate = options.filter((option) => option.kind === 'UNDERGRADUATE');
    const postgraduate = options.filter((option) => option.kind === 'POSTGRADUATE');

    expect(options.slice(0, undergraduate.length)).toEqual(undergraduate);
    expect(options.slice(undergraduate.length)).toEqual(postgraduate);

    const years = undergraduate.map((option) => option.intakeYear ?? 0);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });

  it('offers nothing that produces an empty week', () => {
    for (const option of options) {
      const section = option.sections[0] ?? WHOLE_COHORT_SECTION;
      const found = week.some(
        (day) =>
          selectForStudent(day.entries, {
            cohortLabel: option.label,
            programCode: option.programCode ?? '',
            intakeYear: option.intakeYear,
            section,
          }).length > 0,
      );
      expect(found, `${option.label} section ${section} has no classes all week`).toBe(true);
    }
  });
});

describe('the whole-cohort sentinel', () => {
  /**
   * A section identifier is a letter and at most one digit, so `ALL` can never
   * be mistaken for one. If that ever stopped being true, a student in a real
   * section would silently be shown their whole programme's week.
   */
  it('cannot collide with a section the sheet could publish', () => {
    expect(isSectionIdentifier(WHOLE_COHORT_SECTION)).toBe(false);
    for (const option of options) {
      expect(option.sections).not.toContain(WHOLE_COHORT_SECTION);
    }
  });

  it('selects a whole-cohort programme without naming a section', () => {
    const monday = week[0];
    if (monday === undefined) throw new Error('no monday');

    const matches = selectForStudent(monday.entries, {
      cohortLabel: 'BS AI (2022)',
      programCode: 'AI',
      intakeYear: 2022,
      section: WHOLE_COHORT_SECTION,
    });

    expect(matches.map((match) => match.entry.courseLabel)).toContain('Blockchain');
    expect(matches.every((match) => match.reason === 'WHOLE_COHORT')).toBe(true);
  });
});

describe('finding a stored choice again', () => {
  it('returns the option a label names', () => {
    expect(findCohort(options, 'BS CS (2025)')?.programCode).toBe('CS');
  });

  /**
   * Cohorts graduate and sections merge. A stored label that no longer exists
   * has to come back as "not chosen" so the picker reappears, rather than
   * quietly selecting nothing and looking like a day with no classes.
   */
  it('returns nothing for a label the sheet no longer has', () => {
    expect(findCohort(options, 'BS CS (2019)')).toBeNull();
    expect(findCohort(options, null)).toBeNull();
    expect(findCohort(options, '')).toBeNull();
  });
});
