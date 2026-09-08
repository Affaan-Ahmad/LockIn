import { buildGrid } from './grid';
import type { Grid } from './grid.types';
import { readLegend } from './legend';
import { parseCellSegment } from './cell-text';
import { parseTimeRange, slotsAreChronological } from './time-of-day';
import type {
  Cohort,
  ParseDiagnostic,
  TimeRange,
  TimetableDay,
  TimetableEntry,
  Weekday,
} from './types';

/**
 * Assembly of one day tab into timetable entries.
 *
 * The tab holds two grids stacked vertically -- 80-minute teaching slots above,
 * longer laboratory blocks below -- each introduced by its own header row of
 * times. A cell therefore takes its time from the nearest header *above* it,
 * not from a single header for the sheet.
 *
 * Rooms work the same way horizontally. The header row carries a `Room` label
 * before each block of slots, and the evening block has its own, so a class at
 * column 34 belongs to the room named in the second room column, not the first.
 * Reading the leftmost column for every cell would put every evening class in
 * the wrong building.
 */

interface Slot {
  readonly column: number;
  readonly span: number;
  readonly range: TimeRange | null;
  readonly raw: string;
}

interface SlotHeader {
  readonly row: number;
  readonly slots: readonly Slot[];
  /** Columns whose header cell reads `Room` or `Lab`; each precedes a block of slots. */
  readonly roomColumns: readonly number[];
}

/** A header row is one that announces several times. Three is past coincidence. */
const MINIMUM_SLOTS_IN_HEADER = 3;
const ROOM_LABEL = /^(room|lab)$/i;
/** A cell says something only if it holds a letter or a digit. */
const HAS_CONTENT = /[\p{L}\p{N}]/u;
const TIME_RANGE_ONLY = /^\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/;

const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  MONDAY: 'monday',
  TUESDAY: 'tuesday',
  WEDNESDAY: 'wednesday',
  THURSDAY: 'thursday',
  FRIDAY: 'friday',
};

function findSlotHeaders(grid: Grid): readonly SlotHeader[] {
  const headers: SlotHeader[] = [];

  grid.forEach((cells, row) => {
    const slots: Slot[] = [];
    const roomColumns: number[] = [];

    cells.forEach((cell, column) => {
      if (cell === undefined || !cell.isAnchor) return;
      if (ROOM_LABEL.test(cell.text)) {
        roomColumns.push(column);
        return;
      }
      if (!TIME_RANGE_ONLY.test(cell.text)) return;
      slots.push({
        column,
        span: cell.colSpan,
        range: parseTimeRange(cell.text),
        raw: cell.text,
      });
    });

    // Three times is past coincidence on its own. But a row that also carries a
    // `Room` or `Lab` label is announcing a block whatever its length, and one
    // tab's laboratory grid publishes only two sittings -- which, unrecognised,
    // timed every laboratory class that day against the lecture grid above it.
    const isHeader =
      slots.length >= MINIMUM_SLOTS_IN_HEADER || (roomColumns.length > 0 && slots.length >= 1);
    if (isHeader) headers.push({ row, slots, roomColumns });
  });

  return headers;
}

const headerAbove = (headers: readonly SlotHeader[], row: number): SlotHeader | null => {
  let found: SlotHeader | null = null;
  for (const header of headers) {
    if (header.row < row) found = header;
    else break;
  }
  return found;
};

/**
 * The slot a cell belongs to.
 *
 * Normally a cell starts inside a slot's own columns. But the grid leaves a
 * narrow spacer between blocks, and the registrar uses it: a class beginning
 * before its column's published time is nudged left into that gap. One such
 * cell -- `Exp Writing (CY-B) 11:20-01:05 Cancelled` -- sat entirely in a
 * spacer, matched no slot, and was dropped, which is how a cancelled class
 * disappears instead of reaching the student it was cancelled on.
 *
 * So a cell that starts in a gap is placed by the first slot its own width
 * reaches into. Its time is unaffected either way: such a cell spells its hours
 * out in its text, and text always beats the column.
 */
const slotFor = (header: SlotHeader, column: number, span: number): Slot | null => {
  const containing = header.slots.find(
    (slot) => column >= slot.column && column < slot.column + slot.span,
  );
  if (containing !== undefined) return containing;

  const end = column + span;
  return header.slots.find((slot) => column < slot.column + slot.span && slot.column < end) ?? null;
};

/**
 * The room column governing a cell is the nearest room label to its left.
 *
 * A room is read from a room column or not at all. Scanning further left for
 * *something* looks more forgiving and is worse: the published export puts a
 * gutter of spreadsheet row numbers at column zero, so a row whose room cell is
 * blank came back holding a class in "room 57". An empty room is a fact the
 * interface can show; a fabricated one is not. Where the sheet does this it has
 * written the room into the cell instead, and that text survives in the notes.
 */
function roomFor(grid: Grid, header: SlotHeader, row: number, column: number): string {
  let best: number | null = null;
  for (const roomColumn of header.roomColumns) {
    if (roomColumn < column && (best === null || roomColumn > best)) best = roomColumn;
  }
  if (best === null) return '';
  return grid[row]?.[best]?.text.trim() ?? '';
}

/**
 * Picks the cohort a colour stands for.
 *
 * One colour in this sheet has two meanings -- `#ffe599` is both `BS CS (2022)`
 * and `MS (AI)` -- so where the legend is ambiguous the programme named in the
 * cell is used to settle it. If that does not settle it, the entry gets no
 * cohort and is reported, rather than being assigned to whichever came first.
 */
function resolveCohort(
  candidates: readonly Cohort[] | undefined,
  programCodes: readonly string[],
): { readonly cohort: Cohort | null; readonly ambiguous: boolean } {
  if (candidates === undefined || candidates.length === 0) {
    return { cohort: null, ambiguous: false };
  }
  if (candidates.length === 1) return { cohort: candidates[0] ?? null, ambiguous: false };

  const matching = candidates.filter(
    (candidate) => candidate.programCode !== null && programCodes.includes(candidate.programCode),
  );
  if (matching.length === 1) return { cohort: matching[0] ?? null, ambiguous: false };
  return { cohort: null, ambiguous: true };
}

const ANY_WEEKDAY = /^(monday|tuesday|wednesday|thursday|friday)\b/i;

/** Finds the tab's day heading in the first rows, wherever the export put it. */
function findDayLabel(grid: Grid): string {
  for (let row = 0; row < Math.min(3, grid.length); row += 1) {
    for (const cell of grid[row] ?? []) {
      if (cell === undefined || !cell.isAnchor) continue;
      const text = cell.text.trim();
      if (ANY_WEEKDAY.test(text)) return text;
    }
  }
  return '';
}

/**
 * Every value printed down a room column, in sheet order and without repeats.
 *
 * Only rows below the first header are read. Above it sit the legend, the day's
 * title, and -- in the published export -- a row of spreadsheet column letters,
 * all of which occupy the same columns and would otherwise be offered to a
 * student as rooms called `A`, `AE` and `Monday`.
 */
function readRooms(grid: Grid, headers: readonly SlotHeader[]): readonly string[] {
  const firstHeaderRow = headers[0]?.row ?? 0;
  const headerRows = new Set(headers.map((header) => header.row));
  const rooms: string[] = [];
  const seen = new Set<string>();

  grid.forEach((cells, row) => {
    if (row <= firstHeaderRow || headerRows.has(row)) return;
    for (const header of headers) {
      for (const column of header.roomColumns) {
        const text = cells?.[column]?.text.trim() ?? '';
        if (text === '' || ROOM_LABEL.test(text) || seen.has(text)) continue;
        seen.add(text);
        rooms.push(text);
      }
    }
  });

  return rooms;
}

/**
 * Parses an already-reconstructed grid.
 *
 * Everything below this point is independent of where the grid came from.
 * That split is deliberate: the published HTML is one source, and the Sheets
 * API -- which returns the same three facts as JSON, reached with credentials
 * instead of a public link -- is another. Only the adapter differs.
 */
export function parseTimetableGrid(grid: Grid, weekday: Weekday): TimetableDay {

  // Folded by code and detail so a block repeated across a hundred cells shows
  // up once, with a count, instead of burying every other problem.
  const collected = new Map<string, { diagnostic: ParseDiagnostic; occurrences: number }>();
  const note = (
    code: ParseDiagnostic['code'],
    detail: string,
    row: number | null = null,
    column: number | null = null,
  ): void => {
    const key = `${code}::${detail}`;
    const existing = collected.get(key);
    if (existing === undefined) {
      collected.set(key, {
        diagnostic: { code, detail, row, column, occurrences: 1 },
        occurrences: 1,
      });
      return;
    }
    existing.occurrences += 1;
  };
  const diagnostics = (): readonly ParseDiagnostic[] =>
    [...collected.values()].map(({ diagnostic, occurrences }) => ({ ...diagnostic, occurrences }));

  const headers = findSlotHeaders(grid);

  // The tab names its own day, but not always in the first cell: `htmlview`
  // adds a row and a column of spreadsheet headings when asked for them, so the
  // label is found by looking rather than by assuming a position.
  const dayLabel = findDayLabel(grid);
  const firstHeader = headers[0];
  if (firstHeader === undefined) {
    note('NO_SLOT_HEADER', 'No row announced a set of teaching times, so no cell can be placed.');
    return { weekday, dayLabel, entries: [], rooms: [], legend: new Map(), diagnostics: diagnostics() };
  }

  // A gid is an opaque number, so fetching the wrong tab is a silent failure
  // unless the tab is asked to name itself. The label is only required to
  // *contain* the day, because one tab reads `Friday ONLINE`.
  if (dayLabel !== '' && !dayLabel.toLowerCase().includes(WEEKDAY_NAMES[weekday])) {
    note('UNPARSED_CELL', `Tab is labelled "${dayLabel}" but was read as ${weekday}.`, 0, 0);
  }

  const slotRanges = firstHeader.slots
    .map((slot) => slot.range)
    .filter((range): range is TimeRange => range !== null);
  if (!slotsAreChronological(slotRanges)) {
    note('UNREADABLE_TIME', 'Slot headers do not run forwards; the meridiem rule did not hold.');
  }

  const legend = readLegend(grid, firstHeader.row);
  if (legend.size === 0) {
    note('NO_LEGEND', 'No colour legend was found, so no class can be attributed to a batch.');
  }

  const headerRows = new Set(headers.map((header) => header.row));
  const entries: TimetableEntry[] = [];

  grid.forEach((cells, row) => {
    if (row <= firstHeader.row || headerRows.has(row)) return;
    const header = headerAbove(headers, row);
    if (header === null) return;

    cells.forEach((cell, column) => {
      if (cell === undefined || !cell.isAnchor || cell.text === '') return;
      // A lone dash or bullet is a spacer the registrar typed. There is no class
      // in it to keep, and carrying it through would put an empty row in front
      // of a student as though it meant something.
      if (!HAS_CONTENT.test(cell.text)) return;

      // The header names a room column before each block of slots, and those
      // columns hold room labels in every data row. They are not classes, and
      // the widened slot lookup below would otherwise adopt them.
      if (header.roomColumns.includes(column)) return;

      // Left of the first sitting is the room column and the export's own row
      // gutter. Nothing there is a class.
      if (column < (header.slots[0]?.column ?? 0)) return;

      // A null slot means the column lies outside every sitting the header
      // publishes -- one tab's laboratory header names two blocks while the
      // rows beneath it use a third. The class is real and is kept; what is
      // unknown is when it runs, and that stays unknown rather than borrowing
      // the nearest time.
      const slot = slotFor(header, column, cell.colSpan);

      const room = roomFor(grid, header, row, column);
      let previous: TimetableEntry | null = null;

      for (const segment of cell.segments) {
        const parsed = parseCellSegment(segment);

        // A segment naming no section after one that did is a wrapped
        // continuation -- `Math-1 (AI-M) Pre-Medical` / `International
        // Students` -- not a second class.
        if (!parsed.hasSectionSpec && previous !== null) {
          const merged: TimetableEntry = {
            ...previous,
            notes: [...previous.notes, parsed.raw],
            raw: `${previous.raw} ${parsed.raw}`.trim(),
          };
          entries[entries.length - 1] = merged;
          previous = merged;
          continue;
        }

        const { cohort, ambiguous } = resolveCohort(
          cell.colour === null ? undefined : legend.get(cell.colour),
          parsed.programCodes,
        );

        if (cell.colour === null || (cohort === null && !ambiguous)) {
          note(
            'UNKNOWN_COLOUR',
            `No legend entry for ${cell.colour ?? 'an uncoloured cell'}: "${parsed.raw}".`,
            row,
            column,
          );
        } else if (ambiguous) {
          note('AMBIGUOUS_COLOUR', `${cell.colour} has two meanings: "${parsed.raw}".`, row, column);
        }
        if (!parsed.hasSectionSpec) {
          note('UNPARSED_CELL', `No section could be read from "${parsed.raw}".`, row, column);
        }

        const time = parsed.time ?? slot?.range ?? null;
        if (time === null) {
          note(
            'UNREADABLE_TIME',
            slot === null
              ? `Column ${column} is outside every published sitting: "${parsed.raw}".`
              : `Neither cell nor column gave a time for "${parsed.raw}".`,
            row,
            column,
          );
        }

        const status = parsed.cancelled
          ? 'CANCELLED'
          : parsed.hasSectionSpec && cohort !== null && time !== null
            ? 'SCHEDULED'
            : 'UNCERTAIN';

        const entry: TimetableEntry = {
          weekday,
          room,
          courseLabel: parsed.courseLabel,
          sections: parsed.sections,
          wholeCohort: parsed.wholeCohort,
          cohort,
          colour: cell.colour,
          intakeYearHint: parsed.intakeYearHint,
          groups: parsed.groups,
          time,
          timeSource: time === null ? null : parsed.time !== null ? 'CELL_TEXT' : 'COLUMN_SLOT',
          extendedUntilMinute: parsed.extendedUntilMinute,
          notes: parsed.notes,
          status,
          raw: parsed.raw,
          row,
          column,
        };

        entries.push(entry);
        previous = entry;
      }
    });
  });

  return { weekday, dayLabel, entries, rooms: readRooms(grid, headers), legend, diagnostics: diagnostics() };
}

/** Convenience wrapper for the published `htmlview` export. */
export function parseTimetableDay(html: string, weekday: Weekday): TimetableDay {
  return parseTimetableGrid(buildGrid(html), weekday);
}
