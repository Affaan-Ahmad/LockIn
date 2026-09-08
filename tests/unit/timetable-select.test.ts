import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseTimetableDay } from '@/domain/timetable/parse-day';
import { byStartTime, selectForStudent } from '@/domain/timetable/select';
import type { StudentTimetableIdentity } from '@/domain/timetable/select';
import type { Cohort, TimetableEntry, Weekday } from '@/domain/timetable/types';

/**
 * Choosing one student's classes out of a whole university's timetable.
 *
 * The bias under test is the product's, not this module's: hiding a class a
 * student has costs them the class, while showing one they do not have costs
 * them a glance. So the tests below check both that the obvious things match
 * and that the genuinely open ones -- an unsplit lab, an unreadable section in
 * the right colour -- come back as POSSIBLE rather than vanishing.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/timetable/${name}.html`, import.meta.url)), 'utf8');

const day = (file: string, weekday: Weekday) => parseTimetableDay(fixture(file), weekday);

const monday = day('monday', 'MONDAY');
const tuesday = day('tuesday', 'TUESDAY');

const firstYearCsA: StudentTimetableIdentity = {
  cohortLabel: 'BS CS (2025)',
  programCode: 'CS',
  intakeYear: 2025,
  section: 'A',
};

const select = (entries: readonly TimetableEntry[], who = firstYearCsA) =>
  selectForStudent(entries, who);

describe('selecting a student\'s day', () => {
  it('returns their own sections, in their own rooms', () => {
    const matches = [...select(monday.entries)].sort(byStartTime);
    expect(
      matches.map((m) => `${m.entry.courseLabel} ${m.entry.room}`),
    ).toEqual([
      'OOP C-301',
      'Discrete C-301',
      'MV Calculus C-303',
      'PF C-303',
    ]);
    expect(matches.every((m) => m.confidence === 'MATCH')).toBe(true);
  });

  /**
   * The whole point of reading the colour. `DB (CS-A)` is a third-year class
   * whose section string is identical to this first-year student's.
   */
  it('excludes an identically-labelled section from another intake', () => {
    const matched = select(monday.entries).map((m) => m.entry.raw);
    expect(matched).toContain('OOP (CS-A)');
    expect(matched).not.toContain('DB (CS-A)');
  });

  it('excludes other sections of the same intake', () => {
    const matched = select(monday.entries).map((m) => m.entry.raw);
    expect(matched).not.toContain('OOP (CS-B)');
    expect(matched).not.toContain('Discrete (CS-D)');
  });

  it('sorts by start time, and never lets a timeless entry displace a real one', () => {
    const sorted = [...select(monday.entries)].sort(byStartTime);
    const starts = sorted.map((m) => m.entry.time?.startMinute ?? Number.POSITIVE_INFINITY);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('what is offered rather than asserted', () => {
  /**
   * Which laboratory subgroup a student belongs to is not published anywhere in
   * the sheet, so both are shown and marked as possibilities.
   */
  it('offers both laboratory subgroups to a student in that section', () => {
    // Monday splits section F into F1 and F2; Tuesday splits A and B instead.
    const inSectionF: StudentTimetableIdentity = { ...firstYearCsA, section: 'F' };
    const labs = select(monday.entries, inSectionF)
      .filter((m) => m.reason === 'LAB_SUBGROUP');

    expect(labs.length).toBeGreaterThanOrEqual(2);
    expect(labs.every((m) => m.confidence === 'POSSIBLE')).toBe(true);
    expect(new Set(labs.flatMap((m) => m.entry.sections.map((s) => s.section))))
      .toEqual(new Set(['F1', 'F2']));
  });

  it('follows the split to whichever day the sheet put it on', () => {
    // Section A's laboratory is split on Tuesday, not Monday. The rule is about
    // the section identifier, not about a fixed day or room.
    const labs = select(tuesday.entries).filter((m) => m.reason === 'LAB_SUBGROUP');
    expect(new Set(labs.flatMap((m) => m.entry.sections.map((s) => s.section))))
      .toEqual(new Set(['A1', 'A2']));
    expect(select(monday.entries).some((m) => m.reason === 'LAB_SUBGROUP')).toBe(false);
  });

  it('does not offer a neighbouring section as a subgroup', () => {
    // E1/E2 sit in the same rooms on the same day, so a loose prefix rule would
    // hand section F a laboratory belonging to section E.
    const inSectionF: StudentTimetableIdentity = { ...firstYearCsA, section: 'F' };
    for (const match of select(monday.entries, inSectionF)) {
      for (const section of match.entry.sections) {
        expect(section.section.startsWith('F')).toBe(true);
      }
    }
  });

  it('offers a class in their colour whose section could not be read', () => {
    const cohort: Cohort = {
      label: 'BS CS (2025)', programCode: 'CS', intakeYear: 2025, kind: 'UNDERGRADUATE',
    };
    const unreadable: TimetableEntry = {
      weekday: 'MONDAY',
      room: 'C-301',
      courseLabel: 'Sessional Retake Exams',
      sections: [],
      wholeCohort: false,
      cohort,
      colour: '#ffb740',
      intakeYearHint: null,
      groups: [],
      time: { startMinute: 8 * 60 + 30, endMinute: 9 * 60 + 50 },
      timeSource: 'COLUMN_SLOT',
      extendedUntilMinute: null,
      notes: [],
      status: 'UNCERTAIN',
      raw: 'Sessional Retake Exams',
      row: 20,
      column: 3,
    };

    const [match] = select([unreadable]);
    expect(match?.confidence).toBe('POSSIBLE');
    expect(match?.reason).toBe('UNREADABLE_SECTION');
  });
});

describe('cohorts that are not a plain programme and intake', () => {
  it('gives a whole-cohort class to everyone in that cohort', () => {
    const mastersAi: StudentTimetableIdentity = {
      cohortLabel: 'BS AI (2022)', programCode: 'AI', intakeYear: 2022, section: 'A',
    };
    const matched = select(monday.entries, mastersAi);
    const blockchain = matched.find((m) => m.entry.courseLabel === 'Blockchain');

    expect(blockchain?.reason).toBe('WHOLE_COHORT');
    expect(blockchain?.confidence).toBe('MATCH');
  });

  /**
   * A repeat course's colour says "repeat" instead of naming an intake, so the
   * intake is written inside the cell and has to be read from there.
   */
  it('matches a repeat course on the intake written in the cell', () => {
    const matched = select(monday.entries).map((m) => m.entry.raw);
    expect(matched).toContain('PF (CS-A, 25)');
  });

  it('does not give a repeat course to a different intake', () => {
    const secondYear: StudentTimetableIdentity = {
      cohortLabel: 'BS CS (2024)', programCode: 'CS', intakeYear: 2024, section: 'A',
    };
    expect(select(monday.entries, secondYear).map((m) => m.entry.raw))
      .not.toContain('PF (CS-A, 25)');
  });

  it('gives a second-year student their own classes instead', () => {
    const secondYear: StudentTimetableIdentity = {
      cohortLabel: 'BS CS (2024)', programCode: 'CS', intakeYear: 2024, section: 'A',
    };
    const matched = select(monday.entries, secondYear).map((m) => m.entry.raw);
    expect(matched).toContain('DB (CS-A)');
    expect(matched).not.toContain('OOP (CS-A)');
  });
});

describe('a cancelled class', () => {
  it('is still returned, so the student learns it is not happening', () => {
    const inSectionC: StudentTimetableIdentity = { ...firstYearCsA, section: 'C' };
    const cancelled = select(monday.entries, inSectionC)
      .filter((m) => m.entry.status === 'CANCELLED');

    expect(cancelled.map((m) => m.entry.courseLabel)).toContain('PF Lab');
  });
});
