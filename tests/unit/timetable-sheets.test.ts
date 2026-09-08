import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildGrid } from '@/domain/timetable/grid';
import {
  buildGridFromSheet,
  classifyDayTab,
  selectStandingWeek,
  toHexColour,
} from '@/domain/timetable/grid-from-sheets';
import type { SheetsSheet } from '@/domain/timetable/grid-from-sheets';
import { parseTimetableGrid } from '@/domain/timetable/parse-day';
import type { TimetableEntry } from '@/domain/timetable/types';

/**
 * The credentialed source: the Sheets API v4 response, adapted into the same
 * grid the HTML export produces.
 *
 * The fixtures were captured from the live document with an API key while it was
 * still publicly readable. `monday.sheets.json` is the full response for one day
 * with the field mask the client uses; `tabs.sheets.json` is the tab listing,
 * which is what reveals that the document holds more tabs than it shows.
 */

const path = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/timetable/${name}`, import.meta.url));

const html = readFileSync(path('monday.html'), 'utf8');
const mondayApi = JSON.parse(readFileSync(path('monday.sheets.json'), 'utf8')) as {
  readonly sheets: readonly SheetsSheet[];
};
const tabs = JSON.parse(readFileSync(path('tabs.sheets.json'), 'utf8')) as {
  readonly sheets: readonly SheetsSheet[];
};

const mondaySheet = mondayApi.sheets[0];
if (mondaySheet === undefined) throw new Error('monday.sheets.json holds no sheet');

describe('reading a colour out of the API response', () => {
  it('converts full RGB floats to the hex the legend is keyed by', () => {
    expect(toHexColour({ red: 1, green: 0.7176471, blue: 0.2509804 })).toBe('#ffb740');
    expect(toHexColour({ red: 1, green: 1, blue: 1 })).toBe('#ffffff');
  });

  /**
   * The gotcha that would have been invisible until a whole cohort went missing.
   * Google omits zero-valued fields, so pure blue -- BS CY (2025) -- arrives with
   * no `red` and no `green` key at all. Treating an absent channel as anything
   * but zero yields `NaN` and a colour that matches no legend entry.
   */
  it('treats an absent channel as zero, because the API omits them', () => {
    expect(toHexColour({ blue: 1 })).toBe('#0000ff');
    expect(toHexColour({ red: 1, green: 0.6 })).toBe('#ff9900');
    expect(toHexColour({})).toBe('#000000');
  });

  it('has no colour at all when the cell reports no background', () => {
    expect(toHexColour(undefined)).toBeNull();
  });

  it('clamps rather than emitting a malformed hex string', () => {
    expect(toHexColour({ red: 2, green: -1, blue: 0.5 })).toBe('#ff0080');
  });
});

describe('rebuilding merges from the API response', () => {
  /**
   * Only a merge's anchor carries its text and colour; every other cell in the
   * range reports white and no value. Reading colour from a filled cell would
   * lose the batch, which is the one thing the colour is there to say.
   */
  it('carries the anchor\'s text and colour across the whole merged range', () => {
    const grid = buildGridFromSheet(mondaySheet);
    const anchor = grid[5]?.[1];
    expect(anchor?.text).toBe('OOP (CS-A)');
    expect(anchor?.colour).toBe('#ffb740');
    expect(anchor?.isAnchor).toBe(true);
    expect(anchor?.colSpan).toBeGreaterThan(1);

    // The cell immediately right of the anchor reports white in the raw response.
    const filled = grid[5]?.[2];
    expect(filled?.text).toBe('OOP (CS-A)');
    expect(filled?.colour).toBe('#ffb740');
    expect(filled?.isAnchor).toBe(false);
  });

  it('splits a cell holding two classes on its line break', () => {
    const grid = buildGridFromSheet(mondaySheet);
    const shared = grid
      .flat()
      .find((cell) => cell?.isAnchor === true && cell.segments.length > 1
        && cell.segments[0]?.includes('PF Lab'));

    expect(shared?.segments).toEqual([
      'PF Lab (CS-C, 25) Cancelled',
      'OOP Lab (CY-A/B/C) Lab Exam May 04, 2026',
    ]);
  });
});

describe('the tabs the document actually holds', () => {
  it('classifies the standing week apart from dated one-off sittings', () => {
    expect(classifyDayTab({ title: 'Monday' })).toMatchObject({ kind: 'REGULAR', weekday: 'MONDAY' });
    expect(classifyDayTab({ title: 'Friday' })).toMatchObject({ kind: 'REGULAR', weekday: 'FRIDAY' });
    expect(classifyDayTab({ title: 'Welcome' })).toMatchObject({ kind: 'NOT_A_DAY', weekday: null });

    expect(classifyDayTab({ title: 'Monday (May 11)' })).toMatchObject({ kind: 'DATED_SITTING' });
    expect(classifyDayTab({ title: 'Sat (May 09)' })).toMatchObject({ kind: 'DATED_SITTING' });
    expect(classifyDayTab({ title: 'Saturday (Feb.14,2025)' })).toMatchObject({ kind: 'DATED_SITTING' });
  });

  /**
   * The live document carries twelve tabs and shows six. Among the hidden ones
   * are makeup sittings, including one from February 2025. Merging those into
   * the standing week would show a student a class that happened a year ago.
   */
  it('takes only the five visible weekday tabs from the live listing', () => {
    const standing = selectStandingWeek(tabs.sheets);

    expect(standing.map((tab) => tab.title)).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
    ]);
    expect(standing.every((tab) => !tab.hidden)).toBe(true);
    expect(tabs.sheets.length).toBeGreaterThan(standing.length);
  });

  it('never selects a hidden tab, whatever it is called', () => {
    const hidden = tabs.sheets.filter((sheet) => sheet.properties?.hidden === true);
    expect(hidden.length).toBeGreaterThan(0);

    const selectedTitles = new Set(selectStandingWeek(tabs.sheets).map((tab) => tab.title));
    for (const sheet of hidden) {
      expect(selectedTitles.has(sheet.properties?.title ?? '')).toBe(false);
    }
  });
});

describe('the two sources against each other', () => {
  /**
   * The point of this whole file.
   *
   * The HTML path reads CSS classes and `colspan`; the API path reads RGB floats
   * and a list of merge ranges. They share no extraction code, only the parsing
   * that happens after a grid exists. If they agree on every class, every room,
   * every time and every batch for a real day, then swapping the public export
   * for the credentialed API changes the timetable in no way at all -- which is
   * exactly what has to be true before the cutover.
   */
  const identity = (entry: TimetableEntry): string =>
    [
      entry.room,
      entry.time === null ? 'no-time' : `${entry.time.startMinute}-${entry.time.endMinute}`,
      entry.courseLabel,
      entry.sections.map((section) => section.raw).join('/'),
      entry.cohort?.label ?? 'no-cohort',
      entry.colour ?? 'no-colour',
      entry.status,
      entry.notes.join(';'),
    ].join(' | ');

  const fromHtml = parseTimetableGrid(buildGrid(html), 'MONDAY');
  const fromApi = parseTimetableGrid(buildGridFromSheet(mondaySheet), 'MONDAY');

  it('agree on every class of a real day', () => {
    const htmlKeys = fromHtml.entries.map(identity).sort();
    const apiKeys = fromApi.entries.map(identity).sort();

    expect(apiKeys).toEqual(htmlKeys);
    // Guards against both sides collapsing to nothing and trivially agreeing.
    expect(apiKeys.length).toBeGreaterThan(200);
  });

  it('agree on the legend, which is what carries the batch', () => {
    const asPairs = (day: typeof fromHtml) =>
      [...day.legend]
        .map(([colour, cohorts]) => `${colour}=${cohorts.map((c) => c.label).join('|')}`)
        .sort();

    expect(asPairs(fromApi)).toEqual(asPairs(fromHtml));
    expect(fromApi.legend.size).toBeGreaterThanOrEqual(26);
  });

  it('agree on the day heading', () => {
    expect(fromApi.dayLabel).toBe(fromHtml.dayLabel);
  });
});
