import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildGrid } from '@/domain/timetable/grid';
import type { Grid } from '@/domain/timetable/grid.types';
import { parseTimetableGrid } from '@/domain/timetable/parse-day';
import { formatMinuteOfDay, parseExtendedUntil } from '@/domain/timetable/time-of-day';
import type { TimetableDay, TimetableEntry, Weekday } from '@/domain/timetable/types';

/**
 * Is the extracted timetable *correct*, not merely self-consistent?
 *
 * `timetable-sheets.test.ts` shows the HTML and API paths agree with each
 * other. Two implementations of the same misunderstanding would also agree, so
 * this file checks the output against things that must be true of a real
 * timetable regardless of how it was parsed:
 *
 * - nothing populated is silently dropped;
 * - every class is in a room the sheet actually lists;
 * - every time lies inside the published teaching day;
 * - hand-verified entries carry exactly the values a person reading the sheet
 *   would write down.
 *
 * The first of those was not hypothetical. It caught a cancelled class that the
 * parser was discarding outright.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/timetable/${name}`, import.meta.url)), 'utf8');

const DAYS: ReadonlyArray<readonly [file: string, weekday: Weekday]> = [
  ['monday', 'MONDAY'],
  ['tuesday', 'TUESDAY'],
  ['wednesday', 'WEDNESDAY'],
  ['thursday', 'THURSDAY'],
  ['friday', 'FRIDAY'],
];

const gridFor = (file: string): Grid => buildGrid(fixture(`${file}.html`));
const dayFor = (file: string, weekday: Weekday): TimetableDay =>
  parseTimetableGrid(gridFor(file), weekday);

const IS_TIME = /^\d{1,2}:\d{2}\s*[-–—]/;
const IS_ROOM_LABEL = /^(room|lab)$/i;

/**
 * Rows announcing sittings. Mirrors the parser's rule: three times is enough on
 * its own, and so is a single time beside a `Room`/`Lab` label -- one tab's
 * laboratory header publishes only two.
 */
const headerRowsOf = (grid: Grid): readonly number[] =>
  grid
    .map((cells, row) => ({
      row,
      slots: cells.filter((cell) => cell?.isAnchor === true && IS_TIME.test(cell.text)).length,
      labels: cells.filter((cell) => cell?.isAnchor === true && IS_ROOM_LABEL.test(cell.text)).length,
    }))
    .filter((candidate) => candidate.slots >= 3 || (candidate.labels > 0 && candidate.slots >= 1))
    .map((candidate) => candidate.row);

/** Columns that hold room names rather than classes, per the header's labels. */
const roomColumnsOf = (grid: Grid, headerRow: number): readonly number[] =>
  (grid[headerRow] ?? [])
    .map((cell, column) => (cell?.isAnchor === true && IS_ROOM_LABEL.test(cell.text) ? column : -1))
    .filter((column) => column >= 0);

const overlaps = (a: TimetableEntry, b: TimetableEntry): boolean =>
  a.time !== null &&
  b.time !== null &&
  a.time.startMinute < b.time.endMinute &&
  b.time.startMinute < a.time.endMinute;

describe('nothing is silently dropped', () => {
  /**
   * The regression this exists for: `Exp Writing (CY-B) 11:20-01:05 Cancelled`
   * was anchored in the spacer between two slot blocks -- the registrar nudges a
   * cell left to show a class starting before its column's published time -- so
   * it matched no slot and vanished. A cancelled class that never reaches the
   * student it was cancelled on is the worst possible thing for this parser to
   * lose.
   */
  it.each(DAYS)('%s turns every populated cell into an entry', (file, weekday) => {
    const grid = gridFor(file);
    const day = parseTimetableGrid(grid, weekday);
    const claimed = new Set(day.entries.map((entry) => `${entry.row}:${entry.column}`));

    const headerRows = headerRowsOf(grid);
    const firstHeader = headerRows[0] ?? 0;
    const roomColumns = roomColumnsOf(grid, firstHeader);
    const firstSlot = (grid[firstHeader] ?? []).findIndex(
      (cell) => cell?.isAnchor === true && IS_TIME.test(cell.text),
    );

    const dropped: string[] = [];
    grid.forEach((cells, row) => {
      if (row <= firstHeader || headerRows.includes(row)) return;
      cells.forEach((cell, column) => {
        if (cell?.isAnchor !== true || cell.text === '' || column < firstSlot) return;
        if (roomColumns.includes(column)) return; // a room name, correctly not a class
        // A cell with no letters or digits is a spacer the registrar typed, such
        // as a lone dash. There is nothing in it to lose.
        if (!/[a-z0-9]/i.test(cell.text)) return;
        if (!claimed.has(`${row}:${column}`)) dropped.push(`r${row}c${column} ${cell.text}`);
      });
    });

    expect(dropped).toEqual([]);
  });

  it('keeps the cancelled class that was previously lost to a spacer column', () => {
    const friday = dayFor('friday', 'FRIDAY');
    const lost = friday.entries.find((entry) => entry.raw.startsWith('Exp Writing (CY-B)'));

    expect(lost).toBeDefined();
    expect(lost?.status).toBe('CANCELLED');
    expect(lost?.room).toBe('C-304');
    expect(lost?.cohort?.label).toBe('BS CY (2025)');
    // 11:20 is not a published slot time; it comes from the cell's own text.
    expect(lost?.timeSource).toBe('CELL_TEXT');
    expect(lost?.time).toEqual({ startMinute: 11 * 60 + 20, endMinute: 13 * 60 + 5 });
  });
});

describe('every class is somewhere real, at a real time', () => {
  it.each(DAYS)('%s puts every entry in a room the sheet lists', (file, weekday) => {
    const grid = gridFor(file);
    const day = parseTimetableGrid(grid, weekday);

    // Independent derivation: gather every value appearing in a room column.
    const published = new Set<string>();
    for (const headerRow of headerRowsOf(grid)) {
      for (const column of roomColumnsOf(grid, headerRow)) {
        for (const cells of grid) {
          const text = cells[column]?.text.trim() ?? '';
          if (text !== '' && !IS_ROOM_LABEL.test(text)) published.add(text);
        }
      }
    }

    expect(published.size).toBeGreaterThan(40);

    // A room is either one the sheet lists, or absent. Never invented: this
    // caught entries placed in "room 57", which is the spreadsheet's row-number
    // gutter rather than anywhere on campus.
    const unknown = day.entries.filter(
      (entry) => entry.room !== '' && !published.has(entry.room),
    );
    expect(unknown.map((entry) => `${entry.room} <- ${entry.raw}`)).toEqual([]);

    // A handful of rows leave the room column empty and write the room into the
    // cell instead. Those keep an empty room and their text, rather than
    // borrowing a neighbour's. If this grows, the room columns stopped being
    // found at all.
    const roomless = day.entries.filter((entry) => entry.room === '');
    expect(roomless.length).toBeLessThanOrEqual(2);
    for (const entry of roomless) expect(entry.raw).not.toBe('');
  });

  it.each(DAYS)('%s keeps every class inside the teaching day', (file, weekday) => {
    // The published grid runs 08:30 to 20:05. Anything outside it means a
    // meridiem was resolved wrongly, which is the failure that once left the
    // evening slots with no time at all.
    for (const entry of dayFor(file, weekday).entries) {
      const time = entry.time;
      // A class in a column with no published sitting keeps its text and loses
      // only its time; it must never acquire a plausible-looking wrong one.
      if (time === null) {
        expect(entry.status).toBe('UNCERTAIN');
        continue;
      }
      expect(time.endMinute).toBeGreaterThan(time.startMinute);
      expect(time.startMinute).toBeGreaterThanOrEqual(8 * 60);
      expect(time.endMinute).toBeLessThanOrEqual(20 * 60 + 30);
    }
  });

  it.each(DAYS)('%s gives every scheduled class a course, a cohort and a time', (file, weekday) => {
    for (const entry of dayFor(file, weekday).entries) {
      if (entry.status !== 'SCHEDULED') continue;
      expect(entry.courseLabel).not.toBe('');
      expect(entry.cohort).not.toBeNull();
      expect(entry.time).not.toBeNull();
    }
  });

  it.each(DAYS)('%s never emits two entries from one cell position', (file, weekday) => {
    const day = dayFor(file, weekday);
    const positions = day.entries.map((entry) => `${entry.row}:${entry.column}`);
    // A cell holding two classes contributes both, so positions may repeat --
    // but never more often than that cell has segments.
    const counts = new Map<string, number>();
    for (const position of positions) counts.set(position, (counts.get(position) ?? 0) + 1);
    const grid = gridFor(file);
    for (const [position, count] of counts) {
      const [row, column] = position.split(':').map(Number);
      const segments = grid[row ?? 0]?.[column ?? 0]?.segments.length ?? 0;
      expect(count).toBeLessThanOrEqual(Math.max(segments, 1));
    }
  });
});

describe('the laboratory grid', () => {
  /**
   * Laboratories run in long blocks -- 08:30-11:15 rather than 08:30-09:50 --
   * announced by their own header row lower down the tab.
   *
   * One tab publishes only two laboratory sittings, and the rule that a header
   * needs three times rejected it. Every laboratory class that day was then
   * timed against the lecture grid above, so each one ended an hour and
   * twenty-five minutes before it really does.
   */
  const LAB_BLOCKS = new Set(['08:30-11:15', '11:30-14:15', '14:30-17:15', '17:20-20:05']);

  it.each(DAYS)('%s times its laboratory rooms in laboratory blocks', (file, weekday) => {
    const day = dayFor(file, weekday);
    const inLabRooms = day.entries.filter((entry) => /(IT Lab|CALL|Margala|Rawal|Mehran|Khyber)/i.test(entry.room));
    expect(inLabRooms.length).toBeGreaterThan(5);

    for (const entry of inLabRooms) {
      // A cell may spell out its own hours, and one in an unpublished column has
      // none at all; both are covered by their own assertions above.
      if (entry.timeSource === 'CELL_TEXT' || entry.time === null) continue;
      const span = `${formatMinuteOfDay(entry.time.startMinute)}-${formatMinuteOfDay(entry.time.endMinute)}`;
      expect(LAB_BLOCKS.has(span), `${weekday} ${entry.room} ${entry.raw} -> ${span}`).toBe(true);
    }
  });

  it('reads the two-sitting laboratory header that was previously missed', () => {
    const friday = dayFor('friday', 'FRIDAY');
    const lab = friday.entries.find((entry) => entry.raw === 'PF Lab (CS-A, 25)');

    expect(lab?.room).toBe('D-IT Lab 3');
    expect(lab?.time).toEqual({ startMinute: 8 * 60 + 30, endMinute: 11 * 60 + 15 });
    // A slot header is not a class.
    expect(friday.entries.some((entry) => /^\d{1,2}:\d{2}\s*[-–—]/.test(entry.raw))).toBe(false);
    expect(friday.entries.some((entry) => /^(room|lab)$/i.test(entry.room))).toBe(false);
  });
});

describe('conflicts in the published timetable', () => {
  /**
   * A room hosting two classes at once is either the registrar's mistake or
   * ours. These two are the registrar's: a 105-minute sitting written
   * `08:30-10:15` runs fifteen minutes past the start of the 10:00 slot behind
   * it. They are pinned so that a placement bug -- which would produce many more
   * -- fails this test rather than hiding among them.
   */
  it('finds exactly the two overlaps the source actually contains', () => {
    const clashes: string[] = [];

    for (const [file, weekday] of DAYS) {
      const day = dayFor(file, weekday);
      const byRoom = new Map<string, TimetableEntry[]>();
      for (const entry of day.entries) {
        if (entry.status !== 'SCHEDULED') continue;
        const list = byRoom.get(entry.room);
        if (list === undefined) byRoom.set(entry.room, [entry]);
        else list.push(entry);
      }

      for (const [room, list] of byRoom) {
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i];
            const b = list[j];
            if (a === undefined || b === undefined) continue;
            if (a.raw !== b.raw && overlaps(a, b)) {
              clashes.push(`${weekday} ${room} ${formatMinuteOfDay(a.time?.startMinute ?? 0)}`);
            }
          }
        }
      }
    }

    expect(clashes.sort()).toEqual(['THURSDAY C-305 08:30', 'TUESDAY C-404 08:30']);
  });
});

describe('hand-verified entries', () => {
  /**
   * Each row here was read off the published sheet by eye and then compared with
   * the parser. They are the closest thing to ground truth available without a
   * second copy of the timetable to check against.
   */
  const CASES = [
    {
      file: 'monday', weekday: 'MONDAY' as Weekday, raw: 'OOP (CS-A)',
      room: 'C-301', start: '08:30', end: '09:50', cohort: 'BS CS (2025)',
      sections: ['CS-A'], status: 'SCHEDULED', source: 'COLUMN_SLOT',
    },
    {
      // The same section string as above, a different intake, a different room.
      // Only the cell colour separates them.
      file: 'monday', weekday: 'MONDAY' as Weekday, raw: 'DB (CS-A)',
      room: 'C-409', start: '08:30', end: '09:50', cohort: 'BS CS (2024)',
      sections: ['CS-A'], status: 'SCHEDULED', source: 'COLUMN_SLOT',
    },
    {
      // Evening block: proves the second room column is being read.
      file: 'monday', weekday: 'MONDAY' as Weekday, raw: 'TPL',
      room: 'D-301', start: '17:20', end: '18:40', cohort: undefined,
      sections: [], status: 'UNCERTAIN', source: 'COLUMN_SLOT',
    },
    {
      // Laboratory grid: its own header, its own 2h45m blocks.
      file: 'monday', weekday: 'MONDAY' as Weekday, raw: 'OOP Lab (CS-G)',
      room: 'C-Margala 4', start: '08:30', end: '11:15', cohort: 'BS CS (2025)',
      sections: ['CS-G'], status: 'SCHEDULED', source: 'COLUMN_SLOT',
    },
    {
      file: 'monday', weekday: 'MONDAY' as Weekday, raw: 'PF Lab (CS-C, 25) Cancelled',
      room: 'D-IT Lab 4', start: '14:30', end: '17:15', cohort: 'Repeat Courses',
      sections: ['CS-C'], status: 'CANCELLED', source: 'COLUMN_SLOT',
    },
    {
      // A time written in the cell, overriding the column it sits in.
      file: 'tuesday', weekday: 'TUESDAY' as Weekday, raw: 'Pak Studies (CS-B, 24) 08:30-10:15',
      room: 'C-404', start: '08:30', end: '10:15', cohort: 'BS CS (2024)',
      sections: ['CS-B'], status: 'SCHEDULED', source: 'CELL_TEXT',
    },
    {
      file: 'friday', weekday: 'FRIDAY' as Weekday, raw: 'Exp Writing (CY-B) 11:20-01:05 Cancelled',
      room: 'C-304', start: '11:20', end: '13:05', cohort: 'BS CY (2025)',
      sections: ['CY-B'], status: 'CANCELLED', source: 'CELL_TEXT',
    },
  ] as const;

  it.each(CASES)('$file: $raw', (expected) => {
    const day = dayFor(expected.file, expected.weekday);
    const entry = day.entries.find((candidate) => candidate.raw === expected.raw);

    expect(entry).toBeDefined();
    expect(entry?.room).toBe(expected.room);
    expect(formatMinuteOfDay(entry?.time?.startMinute ?? -1)).toBe(expected.start);
    expect(formatMinuteOfDay(entry?.time?.endMinute ?? -1)).toBe(expected.end);
    expect(entry?.cohort?.label).toBe(expected.cohort);
    expect(entry?.sections.map((section) => section.raw)).toEqual(expected.sections);
    expect(entry?.status).toBe(expected.status);
    expect(entry?.timeSource).toBe(expected.source);
  });
});

describe('extensions, in every form the sheet writes them', () => {
  /**
   * `Extended till 2 pm` -- a bare hour, no minutes -- was returning null while
   * the six other spellings parsed, so two classes silently lost forty-five
   * minutes of their real length.
   */
  const FORMS: ReadonlyArray<readonly [written: string, expected: string]> = [
    ['Extended till 02:00', '14:00'],
    ['Extended till 04:20', '16:20'],
    ['Extended till 05:00', '17:00'],
    ['Extended till 05:15pm', '17:15'],
    ['Extended till 11:20', '11:20'],
    ['Extended till 2 pm', '14:00'],
    ['Extended till 04:45', '16:45'],
  ];

  it.each(FORMS)('reads %j as %s', (written, expected) => {
    const minute = parseExtendedUntil(written);
    expect(minute).not.toBeNull();
    expect(formatMinuteOfDay(minute ?? -1)).toBe(expected);
  });

  it('gives every extended class in the week a resolved end', () => {
    const extended: string[] = [];
    for (const [file, weekday] of DAYS) {
      for (const entry of dayFor(file, weekday).entries) {
        if (!/extended/i.test(entry.raw)) continue;
        extended.push(entry.raw);
        expect(entry.extendedUntilMinute).not.toBeNull();
        // An extension moves the end later, never earlier.
        expect(entry.extendedUntilMinute ?? 0).toBeGreaterThan(entry.time?.endMinute ?? 0);
      }
    }
    expect(extended.length).toBeGreaterThanOrEqual(8);
  });
});
