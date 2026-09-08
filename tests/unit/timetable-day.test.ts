import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseTimetableDay } from '@/domain/timetable/parse-day';
import type { TimetableDay, TimetableEntry, Weekday } from '@/domain/timetable/types';

/**
 * End-to-end parsing of the published day tabs.
 *
 * The fixtures under `tests/fixtures/timetable/` are the real sheet, captured
 * from the `htmlview` export with only `<script>` blocks removed -- the `<style>`
 * block and the `<table>` are verbatim, because the colours live in the former
 * and the merges in the latter. See the README beside them.
 *
 * These assertions are deliberately about *behaviour under real irregularity*
 * rather than about counts, which would churn every time the registrar moves a
 * class. The one count assertion that earns its place is that no class is left
 * without a time, because that is the invariant a silent regression would break.
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

const parseDay = (file: string, weekday: Weekday): TimetableDay =>
  parseTimetableDay(fixture(file), weekday);

const monday = parseDay('monday', 'MONDAY');
const find = (day: TimetableDay, raw: string): TimetableEntry | undefined =>
  day.entries.find((entry) => entry.raw === raw);

describe('every published day tab', () => {
  it.each(DAYS)('%s parses into classes with a legend', (file, weekday) => {
    const day = parseDay(file, weekday);
    expect(day.weekday).toBe(weekday);
    expect(day.entries.length).toBeGreaterThan(150);
    // Every intake of every programme, plus repeats, electives and taught masters.
    expect(day.legend.size).toBeGreaterThanOrEqual(26);
    expect(day.diagnostics.some((d) => d.code === 'NO_LEGEND')).toBe(false);
    expect(day.diagnostics.some((d) => d.code === 'NO_SLOT_HEADER')).toBe(false);
  });

  /**
   * The regression this guards is real and was live until the range rule was
   * added: the evening slots read `05:20-06:40` and `06:45-08:05`, and an end
   * resolved on its own put `08:05` in the morning, so the range ran backwards
   * and every evening and laboratory class silently lost its time.
   */
  it.each(DAYS)('%s gives every scheduled class a time', (file, weekday) => {
    const day = parseDay(file, weekday);
    expect(
      day.entries.filter((entry) => entry.status === 'SCHEDULED' && entry.time === null),
    ).toEqual([]);

    // A cell can sit in a column the header publishes no sitting for. Those keep
    // their text and lose only their time, which makes them UNCERTAIN. They are
    // a handful; if that count grows, a slot header stopped being read.
    const timeless = day.entries.filter((entry) => entry.time === null);
    expect(timeless.length).toBeLessThanOrEqual(3);
    for (const entry of timeless) expect(entry.status).toBe('UNCERTAIN');
  });

  it.each(DAYS)('%s never reports a class ending before it starts', (file, weekday) => {
    for (const entry of parseDay(file, weekday).entries) {
      expect(entry.time?.endMinute ?? 1).toBeGreaterThan(entry.time?.startMinute ?? 0);
    }
  });
});

describe('the batch a class belongs to', () => {
  /**
   * The reason this parser reads HTML rather than CSV. Both cells say `CS-A`.
   * Only the background colour separates a first-year OOP lecture from a
   * third-year database one, so a values-only scrape would merge them and put
   * four intakes into one timetable.
   */
  it('is taken from the cell colour, not from the section text', () => {
    const firstYear = find(monday, 'OOP (CS-A)');
    const thirdYear = find(monday, 'DB (CS-A)');

    expect(firstYear?.sections.map((s) => s.raw)).toEqual(['CS-A']);
    expect(thirdYear?.sections.map((s) => s.raw)).toEqual(['CS-A']);

    expect(firstYear?.cohort?.label).toBe('BS CS (2025)');
    expect(thirdYear?.cohort?.label).toBe('BS CS (2024)');
    expect(firstYear?.colour).not.toBe(thirdYear?.colour);
    expect(firstYear?.room).not.toBe(thirdYear?.room);
  });

  /**
   * One colour carries two legend entries. Where that happens the programme
   * named in the cell settles it; where it cannot, the entry is reported rather
   * than assigned to whichever legend row was read first.
   */
  it('is settled by the programme when one colour has two meanings', () => {
    const undergraduate = find(monday, 'Stat Modeling (CS-E)');
    const masters = find(monday, 'Adv ML (AI)');

    expect(undergraduate?.colour).toBe(masters?.colour);
    expect(undergraduate?.cohort?.label).toBe('BS CS (2022)');
    expect(masters?.cohort?.label).toBe('MS (AI)');
  });

  it('reports the ambiguity when the programme cannot settle it', () => {
    const ambiguous = monday.diagnostics.filter((d) => d.code === 'AMBIGUOUS_COLOUR');
    expect(ambiguous.length).toBeGreaterThan(0);
    for (const entry of monday.entries.filter((e) => e.colour === '#ffe599' && e.cohort === null)) {
      expect(entry.status).toBe('UNCERTAIN');
    }
  });

  it('prefers an intake written in the cell, which is how repeats carry theirs', () => {
    const repeat = find(monday, 'PF (CS-A, 25)');
    expect(repeat?.cohort?.kind).toBe('REPEAT');
    expect(repeat?.intakeYearHint).toBe(2025);
  });
});

describe('cells the registrar wrote by hand', () => {
  it('keeps a wrapped qualifier with its class instead of making a second one', () => {
    const wrapped = monday.entries.filter((entry) => entry.courseLabel === 'Math-1');
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.notes).toEqual(['Pre-Medical', 'International Students']);
    expect(monday.entries.some((entry) => entry.raw === 'International Students')).toBe(false);
  });

  /**
   * One merged cell holding a cancellation and the class replacing it. Reading
   * it as a single item would either lose the replacement or leave the cancelled
   * class looking as though it were still running.
   */
  it('splits a cancellation from the class that replaces it', () => {
    const cancelled = find(monday, 'PF Lab (CS-C, 25) Cancelled');
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.courseLabel).toBe('PF Lab');
    expect(cancelled?.sections.map((s) => s.raw)).toEqual(['CS-C']);

    const replacement = find(monday, 'OOP Lab (CY-A/B/C) Lab Exam May 04, 2026');
    expect(replacement?.status).toBe('SCHEDULED');
    expect(replacement?.sections.map((s) => s.raw)).toEqual(['CY-A', 'CY-B', 'CY-C']);
  });

  it('records an extension without moving the class', () => {
    const extended = find(monday, 'Civics (CS-G) 11:30-01:15 Extended till 02:00');
    expect(extended?.time).toEqual({ startMinute: 11 * 60 + 30, endMinute: 13 * 60 + 15 });
    expect(extended?.extendedUntilMinute).toBe(14 * 60);
  });

  it('reads a time in the cell in preference to the column it sits in', () => {
    const overridden = find(monday, 'Pak Studies (CS-E) 11:30-01:15');
    expect(overridden?.timeSource).toBe('CELL_TEXT');
    expect(find(monday, 'OOP (CS-A)')?.timeSource).toBe('COLUMN_SLOT');
  });
});

describe('placing a class in the room and hour it belongs to', () => {
  /**
   * The header carries a second `Room` column for the evening block. Reading the
   * leftmost room for every cell would move every evening class to a lecture
   * theatre on the other side of the campus.
   */
  it('uses the room column governing the block, not the leftmost one', () => {
    const evening = find(monday, 'TPL');
    expect(evening?.room).toBe('D-301');
    expect(evening?.time?.startMinute).toBe(17 * 60 + 20);
  });

  it('reads the laboratory grid against its own longer slots', () => {
    const lab = monday.entries.find((entry) => entry.raw === 'OOP Lab (CS-G)');
    expect(lab?.time).toEqual({ startMinute: 8 * 60 + 30, endMinute: 11 * 60 + 15 });
    expect(lab?.room).toBe('C-Margala 4');
  });
});

describe('what the parser refuses to do', () => {
  it('marks a block it cannot model as uncertain and keeps its words', () => {
    const friday = parseDay('friday', 'FRIDAY');
    const evaluations = friday.entries.filter((e) => e.raw === 'FYP/Thesis Evaluations');
    expect(evaluations.length).toBeGreaterThan(0);
    for (const entry of evaluations) {
      expect(entry.status).toBe('UNCERTAIN');
      expect(entry.sections).toEqual([]);
      expect(entry.cohort).toBeNull();
      expect(entry.courseLabel).toBe('FYP/Thesis Evaluations');
    }
  });

  it('carries the tab heading through, because it can change where a student goes', () => {
    expect(parseDay('friday', 'FRIDAY').dayLabel).toBe('Friday ONLINE');
    expect(monday.dayLabel).toBe('Monday');
  });

  /** A gid is an opaque number, so fetching the wrong tab has to be loud. */
  it('reports a tab that does not name the day it was read as', () => {
    const wrong = parseTimetableDay(fixture('monday'), 'TUESDAY');
    expect(wrong.diagnostics.some((d) => d.detail.includes('Monday'))).toBe(true);
  });

  it('folds a block repeated across many cells into one diagnostic', () => {
    const friday = parseDay('friday', 'FRIDAY');
    const repeated = friday.diagnostics.find((d) => d.detail.includes('FYP/Thesis Evaluations'));
    expect(repeated?.occurrences).toBeGreaterThan(50);
    // Distinct problems, not a volume count dominated by one benign block.
    expect(friday.diagnostics.length).toBeLessThan(30);
  });
});
