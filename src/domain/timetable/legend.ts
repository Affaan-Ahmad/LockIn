import type { Grid } from './grid.types';
import type { Cohort } from './types';

/**
 * The colour legend printed in the first rows of every day tab.
 *
 * This is the load-bearing part of the whole parser. A cell reading `OOP
 * (CS-A)` names a section but no intake, and four intakes share the letter A;
 * the legend is what says that this particular orange means BS CS (2025) while
 * the dark gold two rows down means BS CS (2024).
 *
 * Only labels matching a recognised shape are accepted. That matters because
 * the sheet's *title* is also a coloured cell in these rows, and it happens to
 * share its yellow with `Repeat Courses` -- accepting every coloured cell would
 * make the title a competing meaning for that colour. Refusing to recognise a
 * new legend shape costs a diagnostic and pushes affected classes to UNCERTAIN,
 * where they are still shown; accepting the wrong one would mislabel a cohort.
 */

/** `BS CS (2025)`, `BS DS (2022)`. */
const PROGRAMME_WITH_INTAKE = /^(BS|MS|PhD)\s+([A-Za-z]{2,4})\s*\((\d{4})\)$/i;
/** `MS (CS)`, `MS (CY)`. */
const PROGRAMME_ONLY = /^(BS|MS|PhD)\s*\(([A-Za-z]{2,4})\)$/i;
/** `Repeat Courses`. The intake is written inside each cell instead. */
const REPEAT = /^repeat\s+courses?$/i;
/** `Elective Courses`, `MS Electives (All Prgrms)`. */
const ELECTIVE = /\belectives?\b/i;

export function parseCohortLabel(label: string): Cohort | null {
  const text = label.replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  const withIntake = PROGRAMME_WITH_INTAKE.exec(text);
  if (withIntake !== null) {
    const degree = (withIntake[1] ?? '').toUpperCase();
    return {
      label: text,
      programCode: (withIntake[2] ?? '').toUpperCase(),
      intakeYear: Number.parseInt(withIntake[3] ?? '', 10),
      kind: degree === 'BS' ? 'UNDERGRADUATE' : 'POSTGRADUATE',
    };
  }

  if (REPEAT.test(text)) {
    return { label: text, programCode: null, intakeYear: null, kind: 'REPEAT' };
  }

  const programmeOnly = PROGRAMME_ONLY.exec(text);
  if (programmeOnly !== null) {
    const degree = (programmeOnly[1] ?? '').toUpperCase();
    return {
      label: text,
      programCode: (programmeOnly[2] ?? '').toUpperCase(),
      intakeYear: null,
      kind: degree === 'BS' ? 'UNDERGRADUATE' : 'POSTGRADUATE',
    };
  }

  if (ELECTIVE.test(text)) {
    return { label: text, programCode: null, intakeYear: null, kind: 'ELECTIVE' };
  }

  return null;
}

/**
 * Reads the legend from the rows above the first slot header.
 *
 * A colour maps to a list rather than one cohort because the sheet reuses at
 * least one: `#ffe599` is both `BS CS (2022)` and `MS (AI)`. That collision is
 * reported to the caller as ambiguity rather than resolved by picking first,
 * because picking would silently assign half those classes to the wrong cohort.
 */
export function readLegend(grid: Grid, beforeRow: number): ReadonlyMap<string, readonly Cohort[]> {
  const legend = new Map<string, Cohort[]>();

  for (let row = 0; row < beforeRow && row < grid.length; row += 1) {
    const cells = grid[row];
    if (cells === undefined) continue;

    for (const cell of cells) {
      if (cell === undefined || !cell.isAnchor || cell.colour === null) continue;
      const cohort = parseCohortLabel(cell.text);
      if (cohort === null) continue;

      const existing = legend.get(cell.colour);
      if (existing === undefined) {
        legend.set(cell.colour, [cohort]);
      } else if (!existing.some((entry) => entry.label === cohort.label)) {
        existing.push(cohort);
      }
    }
  }

  return legend;
}
