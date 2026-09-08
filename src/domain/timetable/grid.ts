import type { GridCell, MutableGrid } from './grid.types';

/**
 * Reconstruction of the published sheet's HTML table into a dense grid.
 *
 * Google's `htmlview` export is the only endpoint that carries what this
 * timetable actually means. `export?format=csv` is refused outright for
 * viewers, and the `gviz` export -- like an IMPORTRANGE mirror -- returns
 * values only. Values are not enough: the batch lives in the cell's background
 * colour, so a values-only scrape silently merges four intakes that share a
 * section letter and would show a first-year student their seniors' classes.
 *
 * Two mechanics are recovered here and nowhere else:
 *
 * - **Merges.** A class occupies one cell spanning several columns. The span is
 *   the duration: four columns is one 80-minute slot, nine is a laboratory
 *   block. Expanding merges into a dense grid also keeps column indices aligned
 *   with the slot header, which is what maps a cell to a time.
 * - **Colour.** Background colours arrive as CSS classes in a `<style>` block
 *   rather than inline, so the class-to-colour map has to be read first.
 *
 * `<br>` is preserved as a segment boundary because the sheet uses one merged
 * cell for two different things -- `PF Lab (CS-C, 25) Cancelled<br>OOP Lab
 * (CY-A/B/C) Lab Exam May 04, 2026` is a cancellation *and* its replacement.
 * Collapsing that to a single string would lose one of the two classes.
 */

/** Sentinel standing in for `<br>` while tags are stripped. Not typeable in a sheet. */
const BREAK = '\u0000';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Maps CSS class name to background colour, lowercased.
 *
 * Only `background-color` is read. `color` is deliberately ignored: the sheet
 * uses foreground colour for legibility against the background, so treating it
 * as meaningful would invent distinctions the author never made.
 */
export function parseBackgroundColours(html: string): ReadonlyMap<string, string> {
  const colours = new Map<string, string>();
  for (const rule of html.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
    const name = rule[1];
    const body = rule[2];
    if (name === undefined || body === undefined) continue;
    const colour = /background-color:\s*(#[0-9a-fA-F]{6})\b/.exec(body);
    if (colour?.[1] !== undefined) colours.set(name, colour[1].toLowerCase());
  }
  return colours;
}

/** Strips markup, turning `<br>` into segment boundaries and collapsing whitespace. */
function readCellText(inner: string): { segments: string[]; text: string } {
  const withBreaks = inner.replace(/<br\s*\/?>/gi, BREAK);
  const stripped = decodeEntities(withBreaks.replace(/<[^>]*>/g, ''));
  const segments = stripped
    .split(BREAK)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment !== '');
  return { segments, text: segments.join(' ') };
}

const attribute = (attrs: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs)?.[1] ?? null;

const span = (attrs: string, name: string): number => {
  const raw = attribute(attrs, name);
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  // A malformed span must not collapse the grid: one column is the safe floor,
  // because it keeps every later column in the row at its true index.
  return Number.isFinite(value) && value >= 1 ? value : 1;
};

/**
 * Expands the first `<table>` in the document into a dense grid.
 *
 * Every cell of a merge is populated, so `grid[r][c]` answers "what occupies
 * this position"; `isAnchor` marks the one position that is the merge's origin,
 * which is where the content actually lives. Callers iterate anchors to visit
 * each class once, and read non-anchor positions to find the room heading a row.
 */
export function buildGrid(html: string): MutableGrid {
  const colours = parseBackgroundColours(html);
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0] ?? html;
  const grid: MutableGrid = [];

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  rows.forEach((rowMatch, rowIndex) => {
    const rowHtml = rowMatch[1] ?? '';
    grid[rowIndex] ??= [];
    let column = 0;

    for (const cellMatch of rowHtml.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const attrs = cellMatch[1] ?? '';
      const { segments, text } = readCellText(cellMatch[2] ?? '');

      let colour: string | null = null;
      for (const className of (attribute(attrs, 'class') ?? '').split(/\s+/)) {
        const found = colours.get(className);
        if (found !== undefined) colour = found;
      }

      const colSpan = span(attrs, 'colspan');
      const rowSpan = span(attrs, 'rowspan');

      // Skip past positions already claimed by a rowspan from an earlier row.
      const target = grid[rowIndex];
      if (target === undefined) continue;
      while (target[column] !== undefined) column += 1;

      for (let dc = 0; dc < colSpan; dc += 1) {
        for (let dr = 0; dr < rowSpan; dr += 1) {
          const cell: GridCell = {
            segments,
            text,
            colour,
            colSpan,
            rowSpan,
            isAnchor: dc === 0 && dr === 0,
          };
          (grid[rowIndex + dr] ??= [])[column + dc] = cell;
        }
      }
      column += colSpan;
    }
  });

  return grid;
}
