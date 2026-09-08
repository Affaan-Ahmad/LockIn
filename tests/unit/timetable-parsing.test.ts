import { describe, expect, it } from 'vitest';

import { parseCellSegment, parseSectionSpec } from '@/domain/timetable/cell-text';
import { parseCohortLabel } from '@/domain/timetable/legend';
import {
  formatMinuteOfDay,
  parseExtendedUntil,
  parseTimeRange,
  resolveMinuteOfDay,
  slotsAreChronological,
} from '@/domain/timetable/time-of-day';

/**
 * The pure layer of the timetable parser: times, cohort labels, and the text of
 * a single cell. Every input below is a string that appears in the published
 * sheet, so these are regression tests against the real document rather than
 * against an idea of what it might contain.
 */

const at = (hour: number, minute: number): number => hour * 60 + minute;

describe('resolveMinuteOfDay', () => {
  const cases: ReadonlyArray<readonly [hour: number, minute: number, expected: number | null]> = [
    [8, 30, at(8, 30)],
    [10, 0, at(10, 0)],
    [11, 30, at(11, 30)],
    [12, 50, at(12, 50)],
    [1, 0, at(13, 0)],
    [2, 30, at(14, 30)],
    [7, 59, at(19, 59)],
    [15, 55, at(15, 55)],
    [0, 30, null],
    [24, 0, null],
    [9, 60, null],
  ];

  it.each(cases)('reads %i:%i as %j', (hour, minute, expected) => {
    expect(resolveMinuteOfDay(hour, minute)).toBe(expected);
  });

  it('believes an explicit meridiem over the teaching-day rule', () => {
    expect(resolveMinuteOfDay(5, 15, 'pm')).toBe(at(17, 15));
    expect(resolveMinuteOfDay(11, 0, 'pm')).toBe(at(23, 0));
    expect(resolveMinuteOfDay(12, 30, 'am')).toBe(at(0, 30));
  });
});

describe('parseTimeRange', () => {
  const cases: ReadonlyArray<readonly [input: string, start: number, end: number]> = [
    ['08:30-09:50', at(8, 30), at(9, 50)],
    ['11:30-12:50', at(11, 30), at(12, 50)],
    ['01:00-02:20', at(13, 0), at(14, 20)],
    ['03:55-05:15', at(15, 55), at(17, 15)],
    ['11:30-02:15', at(11, 30), at(14, 15)],
    ['02:30-05:15', at(14, 30), at(17, 15)],
    ['11:30-01:15', at(11, 30), at(13, 15)],
  ];

  it.each(cases)('reads %j', (input, start, end) => {
    expect(parseTimeRange(input)).toEqual({ startMinute: start, endMinute: end });
  });

  /**
   * The case that the per-time rule alone gets wrong. `06:45` is evening, so the
   * `08:05` that follows it must be evening too -- read on its own it would land
   * at breakfast and the slot would run backwards. Before this was handled the
   * two evening slots produced classes with no time at all.
   */
  it('carries an evening start over an end that reads as morning', () => {
    expect(parseTimeRange('06:45-08:05')).toEqual({
      startMinute: at(18, 45),
      endMinute: at(20, 5),
    });
    expect(parseTimeRange('05:20 - 08:05 (inc. 10 min. break)')).toEqual({
      startMinute: at(17, 20),
      endMinute: at(20, 5),
    });
  });

  it('refuses a range it cannot make run forwards', () => {
    expect(parseTimeRange('10:00am-09:00am')).toBeNull();
    expect(parseTimeRange('no times here')).toBeNull();
  });

  it('confirms the published slot sequence increases under these rules', () => {
    const day = [
      '08:30-09:50', '10:00-11:20', '11:30-12:50', '01:00-02:20',
      '02:30-03:50', '03:55-05:15', '05:20-06:40', '06:45-08:05',
    ].map((raw) => parseTimeRange(raw));

    expect(day.every((range) => range !== null)).toBe(true);
    expect(slotsAreChronological(day.filter((range) => range !== null))).toBe(true);
  });
});

describe('parseExtendedUntil', () => {
  it('reads an extension, with or without a meridiem', () => {
    expect(parseExtendedUntil('Extended till 02:00')).toBe(at(14, 0));
    expect(parseExtendedUntil('Extended till 05:15pm')).toBe(at(17, 15));
    expect(parseExtendedUntil('Extended till 04:45')).toBe(at(16, 45));
  });

  it('is absent when nothing was extended', () => {
    expect(parseExtendedUntil('Civics (CS-A) 11:30-01:15')).toBeNull();
  });
});

describe('formatMinuteOfDay', () => {
  it('renders on a 24-hour clock', () => {
    expect(formatMinuteOfDay(at(8, 30))).toBe('08:30');
    expect(formatMinuteOfDay(at(20, 5))).toBe('20:05');
  });
});

describe('parseCohortLabel', () => {
  it('reads the legend shapes the sheet uses', () => {
    expect(parseCohortLabel('BS CS (2025)')).toEqual({
      label: 'BS CS (2025)', programCode: 'CS', intakeYear: 2025, kind: 'UNDERGRADUATE',
    });
    expect(parseCohortLabel('MS (DS)')).toEqual({
      label: 'MS (DS)', programCode: 'DS', intakeYear: null, kind: 'POSTGRADUATE',
    });
    expect(parseCohortLabel('Repeat Courses')?.kind).toBe('REPEAT');
    expect(parseCohortLabel('Elective Courses')?.kind).toBe('ELECTIVE');
    expect(parseCohortLabel('MS Electives (All Prgrms)')?.kind).toBe('ELECTIVE');
  });

  /**
   * The sheet's own title sits in the legend rows and shares its yellow with
   * `Repeat Courses`. Accepting it would give that colour a second, wrong
   * meaning and make every repeat class ambiguous.
   */
  it('rejects the sheet title, which is coloured but is not a legend entry', () => {
    expect(parseCohortLabel('FSC TimeTable for Spring-2026')).toBeNull();
    expect(parseCohortLabel('')).toBeNull();
  });
});

describe('parseSectionSpec', () => {
  it('reads a plain programme and section', () => {
    expect(parseSectionSpec('CS-A')?.sections.map((s) => s.raw)).toEqual(['CS-A']);
  });

  it('expands combined sections and combined programmes', () => {
    expect(parseSectionSpec('CY-A/B/C')?.sections.map((s) => s.raw))
      .toEqual(['CY-A', 'CY-B', 'CY-C']);
    expect(parseSectionSpec('AI/DS-A')?.sections.map((s) => s.raw)).toEqual(['AI-A', 'DS-A']);
  });

  it('keeps lab subgroups distinct from their section', () => {
    expect(parseSectionSpec('CS-F1')?.sections.map((s) => s.section)).toEqual(['F1']);
  });

  it('reads an intake and an elective group written beside the section', () => {
    expect(parseSectionSpec('CS-A, 25')?.intakeYearHint).toBe(2025);
    expect(parseSectionSpec('CS-A, 2022')?.intakeYearHint).toBe(2022);
    expect(parseSectionSpec('CS-B, G-I')?.groups).toEqual(['G-I']);
  });

  it('treats a degree code as naming a cohort, not a section', () => {
    const spec = parseSectionSpec('MS-DS');
    expect(spec?.sections).toEqual([]);
    expect(spec?.wholeCohort).toBe(true);
    expect(spec?.programCodes).toEqual(['DS']);
  });

  it('treats a bare programme as the whole cohort', () => {
    expect(parseSectionSpec('AI')?.wholeCohort).toBe(true);
    expect(parseSectionSpec('PhD')?.wholeCohort).toBe(true);
  });

  /**
   * `Audi (G-Flr, Blk-D)` is a venue. Reading `G` out of it would invent a class
   * for section G in a room nobody booked, which is the single most damaging
   * mistake this parser could make.
   */
  it('refuses anything that is not a section specification', () => {
    expect(parseSectionSpec('G-Flr, Blk-D')).toBeNull();
    expect(parseSectionSpec('')).toBeNull();
    expect(parseSectionSpec('CS-Alpha')).toBeNull();
  });
});

describe('parseCellSegment', () => {
  it('splits the course from its section', () => {
    const parsed = parseCellSegment('OOP (CS-A)');
    expect(parsed.courseLabel).toBe('OOP');
    expect(parsed.sections.map((s) => s.raw)).toEqual(['CS-A']);
    expect(parsed.hasSectionSpec).toBe(true);
    expect(parsed.time).toBeNull();
  });

  it('takes a time written in the cell', () => {
    const parsed = parseCellSegment('Pak Studies (CS-E) 11:30-01:15');
    expect(parsed.courseLabel).toBe('Pak Studies');
    expect(parsed.time).toEqual({ startMinute: at(11, 30), endMinute: at(13, 15) });
  });

  it('reads an extension without losing the range it extends', () => {
    const parsed = parseCellSegment('Civics (CS-G) 11:30-01:15 Extended till 02:00');
    expect(parsed.time).toEqual({ startMinute: at(11, 30), endMinute: at(13, 15) });
    expect(parsed.extendedUntilMinute).toBe(at(14, 0));
    expect(parsed.notes).toEqual([]);
  });

  it('marks a cancellation', () => {
    expect(parseCellSegment('PF Lab (CS-C, 25) Cancelled').cancelled).toBe(true);
    expect(parseCellSegment('OOP (CS-A)').cancelled).toBe(false);
  });

  it('keeps a venue as a note and never as a section', () => {
    const parsed = parseCellSegment('SPM (SE-A) Audi (G-Flr, Blk-D)');
    expect(parsed.sections.map((s) => s.raw)).toEqual(['SE-A']);
    expect(parsed.notes).toEqual(['Audi (G-Flr, Blk-D)']);
  });

  it('keeps a one-off date as a note', () => {
    const parsed = parseCellSegment('Web (CS-A) on for May 04');
    expect(parsed.sections.map((s) => s.raw)).toEqual(['CS-A']);
    expect(parsed.notes).toEqual(['on for May 04']);
  });

  it('yields no section for text it cannot model, rather than guessing', () => {
    for (const text of ['Tutorial', 'Sessional Retake Exams', 'PPIT SE-F)', 'FYP/Thesis Evaluations']) {
      const parsed = parseCellSegment(text);
      expect(parsed.hasSectionSpec).toBe(false);
      expect(parsed.sections).toEqual([]);
      // The text survives, so a reader can still see what the sheet said.
      expect(parsed.courseLabel).toBe(text);
    }
  });

  it('produces a section key comparable with Classroom section aliases', () => {
    expect(parseCellSegment('OOP (CS-A)').sections[0]?.key).toBe('csa');
  });
});
