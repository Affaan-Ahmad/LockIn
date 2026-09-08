import type { GridCell, MutableGrid } from './grid.types';
import type { Weekday } from './types';

/**
 * Builds the same grid as `grid.ts`, but from a Sheets API v4 response instead
 * of the published HTML.
 *
 * This is the credentialed path. The HTML export works only while the document
 * is publicly readable, which is somebody else's setting to change; the API
 * reaches it as an authenticated member of the university's domain, and is a
 * documented interface rather than a legacy page. Both produce a `Grid`, so
 * everything downstream -- the legend, the cell text, the times, the selection
 * -- is shared.
 *
 * Three properties of the API response are not obvious and each one is a bug if
 * missed. All three were confirmed against the live document rather than read
 * off the specification.
 *
 * 1. **A missing colour channel means zero.** Google omits zero-valued fields,
 *    so pure blue arrives as `{"blue": 1}` with no `red` or `green` at all.
 *    Multiplying an absent channel yields `NaN` and a colour that matches no
 *    legend entry, which would quietly push a whole cohort to UNCERTAIN.
 * 2. **Only a merge's anchor carries its content.** The cells filling out a
 *    merge report white and no value, so the merge list has to be applied to
 *    recover both the text and the colour across the range. Reading colour from
 *    a filled cell would lose the batch.
 * 3. **Line breaks are `\n`.** They separate two classes sharing one cell in
 *    exactly the way `<br>` does in the HTML export.
 */

/** The slice of the API response this adapter reads. Everything else is ignored. */
export interface SheetsColour {
  readonly red?: number;
  readonly green?: number;
  readonly blue?: number;
}

export interface SheetsCell {
  readonly formattedValue?: string;
  readonly effectiveFormat?: { readonly backgroundColor?: SheetsColour };
}

export interface SheetsMerge {
  readonly startRowIndex?: number;
  readonly endRowIndex?: number;
  readonly startColumnIndex?: number;
  readonly endColumnIndex?: number;
}

export interface SheetsProperties {
  readonly title?: string;
  readonly sheetId?: number;
  readonly hidden?: boolean;
}

export interface SheetsSheet {
  readonly properties?: SheetsProperties;
  readonly merges?: readonly SheetsMerge[];
  readonly data?: ReadonlyArray<{ readonly rowData?: ReadonlyArray<{ readonly values?: readonly SheetsCell[] }> }>;
}

const clampChannel = (value: number | undefined): number => {
  // Absent means zero. This is the whole reason `?? 0` is not a defensive habit
  // here but a correctness requirement -- see note 1 above.
  const scaled = Math.round((value ?? 0) * 255);
  return Math.min(255, Math.max(0, scaled));
};

/** `{red: 1, green: 0.7176471, blue: 0.2509804}` -> `#ffb740`. */
export function toHexColour(colour: SheetsColour | undefined): string | null {
  if (colour === undefined) return null;
  return `#${[colour.red, colour.green, colour.blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

const readCell = (cell: SheetsCell | undefined): GridCell => {
  const segments = (cell?.formattedValue ?? '')
    .split('\n')
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment !== '');

  return {
    segments,
    text: segments.join(' '),
    colour: toHexColour(cell?.effectiveFormat?.backgroundColor),
    colSpan: 1,
    rowSpan: 1,
    isAnchor: true,
  };
};

export function buildGridFromSheet(sheet: SheetsSheet): MutableGrid {
  const rows = sheet.data?.[0]?.rowData ?? [];
  const grid: MutableGrid = rows.map((row) => (row.values ?? []).map((cell) => readCell(cell)));

  for (const merge of sheet.merges ?? []) {
    const startRow = merge.startRowIndex ?? 0;
    const startColumn = merge.startColumnIndex ?? 0;
    const endRow = merge.endRowIndex ?? startRow + 1;
    const endColumn = merge.endColumnIndex ?? startColumn + 1;

    // The anchor is the only cell holding the merge's text and colour; the rest
    // of the range reports white and nothing.
    const anchor = grid[startRow]?.[startColumn];
    if (anchor === undefined) continue;

    const colSpan = Math.max(1, endColumn - startColumn);
    const rowSpan = Math.max(1, endRow - startRow);

    for (let row = startRow; row < endRow; row += 1) {
      for (let column = startColumn; column < endColumn; column += 1) {
        (grid[row] ??= [])[column] = {
          ...anchor,
          colSpan,
          rowSpan,
          isAnchor: row === startRow && column === startColumn,
        };
      }
    }
  }

  return grid;
}

export type DayTabKind =
  /** `Monday` -- one of the five tabs that make up the standing timetable. */
  | 'REGULAR'
  /**
   * `Monday (May 11)`, `Sat (May 09)` -- a single dated sitting, for a makeup
   * class or a day moved around a holiday. The document keeps these long after
   * they have passed and hides them, so they are reported rather than merged
   * into the standing week: showing February's makeup class as though it were
   * every Monday would be worse than not showing it at all.
   */
  | 'DATED_SITTING'
  /** `Welcome`, or anything else that is not a day. */
  | 'NOT_A_DAY';

export interface DayTab {
  readonly title: string;
  readonly sheetId: number | null;
  readonly hidden: boolean;
  readonly kind: DayTabKind;
  /** Null for `NOT_A_DAY`, and for dated sittings on a day we do not model. */
  readonly weekday: Weekday | null;
}

const WEEKDAY_BY_NAME: ReadonlyMap<string, Weekday> = new Map([
  ['monday', 'MONDAY'],
  ['tuesday', 'TUESDAY'],
  ['wednesday', 'WEDNESDAY'],
  ['thursday', 'THURSDAY'],
  ['friday', 'FRIDAY'],
]);

/**
 * Classifies a tab by its title.
 *
 * The document carries more tabs than it shows: alongside the five weekdays are
 * dated one-offs, several of them hidden and one over a year old. Reading every
 * tab that merely starts with a weekday name would put a stale sitting into the
 * live timetable, so the standing week is exactly the tabs whose title *is* a
 * weekday.
 */
export function classifyDayTab(properties: SheetsProperties | undefined): DayTab {
  const title = (properties?.title ?? '').trim();
  const hidden = properties?.hidden === true;
  const sheetId = properties?.sheetId ?? null;
  const normalized = title.toLowerCase();

  const exact = WEEKDAY_BY_NAME.get(normalized);
  if (exact !== undefined) {
    return { title, sheetId, hidden, kind: 'REGULAR', weekday: exact };
  }

  const leading = /^(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)[a-z]*\b/.exec(normalized);
  if (leading !== null) {
    const named = WEEKDAY_BY_NAME.get(normalized.split(/[\s(]/)[0] ?? '');
    return { title, sheetId, hidden, kind: 'DATED_SITTING', weekday: named ?? null };
  }

  return { title, sheetId, hidden, kind: 'NOT_A_DAY', weekday: null };
}

/** The five tabs making up the standing week: a weekday title, and visible. */
export function selectStandingWeek(sheets: readonly SheetsSheet[]): readonly DayTab[] {
  return sheets
    .map((sheet) => classifyDayTab(sheet.properties))
    .filter((tab) => tab.kind === 'REGULAR' && !tab.hidden);
}
