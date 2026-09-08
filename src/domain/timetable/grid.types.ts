/** One position in the reconstructed sheet grid. */
export interface GridCell {
  /** Cell text split on `<br>`, each part trimmed; empty parts dropped. */
  readonly segments: readonly string[];
  /** Every segment joined by a space -- the cell as a human reads it. */
  readonly text: string;
  /** Lowercase hex background colour, or null when the cell has none. */
  readonly colour: string | null;
  readonly colSpan: number;
  readonly rowSpan: number;
  /** True only at the merge's origin, where the content belongs. */
  readonly isAnchor: boolean;
}

/**
 * A dense grid. Positions inside a merge repeat the merge's cell; positions no
 * cell reaches are `undefined`, which `noUncheckedIndexedAccess` forces callers
 * to handle anyway.
 */
export type MutableGrid = (GridCell | undefined)[][];
export type Grid = readonly (readonly (GridCell | undefined)[])[];
