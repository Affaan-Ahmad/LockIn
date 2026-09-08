/**
 * Types for the published class timetable.
 *
 * The university publishes one Google Sheet per semester with a tab per
 * weekday. Each tab is a room x time-slot grid: rooms down the left, 80-minute
 * teaching slots across the top, and a second grid lower down for the longer
 * laboratory blocks.
 *
 * Two properties of that sheet drive every type in this file.
 *
 * **The batch is not in the text.** A cell reads `OOP (CS-A)`, which names the
 * course and the section but not the intake. `OOP (CS-A)` and `DB (CS-A)` are
 * different cohorts sharing a section letter, and the only thing separating
 * them is the cell's background colour, decoded against a legend in the first
 * four rows. So `colour` and `cohort` are first-class on every entry, and an
 * entry whose colour is not in the legend is never guessed at.
 *
 * **The sheet is written by hand.** It contains wrapped notes, venue overrides,
 * two classes in one merged cell, cancellations written in prose, and at least
 * one unbalanced bracket. A parser that assumed regularity would either throw
 * away real classes or invent ones that do not exist. So parsing is
 * three-valued in the same way classification is: an entry we cannot fully
 * model becomes UNCERTAIN and keeps its raw text, and is shown rather than
 * dropped.
 */

/**
 * Saturday is included because it is taught: one semester's document publishes
 * a standing Saturday tab alongside the weekdays. Sunday never appears.
 */
export type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY';

/** Minutes since local midnight, 24-hour. The sheet's times are 12-hour and unmarked. */
export type MinuteOfDay = number;

export interface TimeRange {
  readonly startMinute: MinuteOfDay;
  readonly endMinute: MinuteOfDay;
}

/**
 * Where an entry's time came from. Recorded rather than flattened because the
 * two are not equally trustworthy: a column slot is the grid's regular
 * timetable, while text in the cell is the teacher saying "actually, this one
 * runs 02:00-03:45" and overrides it.
 */
export type TimeSource = 'COLUMN_SLOT' | 'CELL_TEXT';

export type EntryStatus =
  /** A normal class. */
  | 'SCHEDULED'
  /** The cell says, in words, that this class is not happening. */
  | 'CANCELLED'
  /**
   * Something is in this cell, but not something we can model -- no section
   * spec, an unreadable time, or a colour absent from the legend. Kept and
   * shown with its raw text, never silently discarded.
   */
  | 'UNCERTAIN';

export type CohortKind =
  | 'UNDERGRADUATE'
  | 'POSTGRADUATE'
  /** `Repeat Courses`: the intake is written inline in the cell instead. */
  | 'REPEAT'
  | 'ELECTIVE'
  | 'OTHER';

/** One entry in the sheet's colour legend. */
export interface Cohort {
  /** Exactly as the legend writes it, e.g. `BS CS (2025)`. */
  readonly label: string;
  /** `CS`, `DS`, `AI`, `CY`, `SE`. Null when the legend names no programme. */
  readonly programCode: string | null;
  /** Admission year, e.g. 2025. Null for legends that carry none. */
  readonly intakeYear: number | null;
  readonly kind: CohortKind;
}

export interface SectionRef {
  /** `CS` from `CS-A`. */
  readonly programCode: string;
  /** `A`, `F1`, `M`. Lab subgroups keep their digit. */
  readonly section: string;
  /** As written: `CS-A`. */
  readonly raw: string;
  /** `normalizeAliasKey('CS-A')` -- comparable with Classroom section aliases. */
  readonly key: string;
}

export interface TimetableEntry {
  readonly weekday: Weekday;
  /** Room label from the row header, e.g. `C-301`, `D-IT Lab 1`. */
  readonly room: string;
  /** Course as written, e.g. `OOP`, `Exp Writing Lab`. Never expanded or renamed. */
  readonly courseLabel: string;
  readonly sections: readonly SectionRef[];
  /**
   * The cell named a programme but no section (`Blockchain (AI)`), so the whole
   * cohort attends. Distinct from an empty `sections` caused by a parse
   * failure, which is UNCERTAIN instead.
   */
  readonly wholeCohort: boolean;
  /** Decoded from the cell colour. Null when the colour is absent from the legend. */
  readonly cohort: Cohort | null;
  readonly colour: string | null;
  /**
   * Intake written inside the cell, as in `(CS-A, 25)` -> 2025. Repeat courses
   * carry their intake this way because the colour slot is spent saying
   * "repeat", so this takes precedence over the cohort's own year.
   */
  readonly intakeYearHint: number | null;
  /** Elective groupings written alongside the section: `G-I`, `G-II`. */
  readonly groups: readonly string[];
  /** Null when no usable time could be read. Never a guessed one. */
  readonly time: TimeRange | null;
  readonly timeSource: TimeSource | null;
  /** From `Extended till 02:00`. The class runs past `time.endMinute`. */
  readonly extendedUntilMinute: MinuteOfDay | null;
  /**
   * Everything else the cell said, verbatim and in order: venue overrides like
   * `Audi (G-Flr, Blk-D)`, qualifiers like `International Students`, one-off
   * notes like `on for May 04`. Deliberately not classified -- deciding which
   * leftover is a room and which is a remark would be guesswork, and the
   * student can read the sheet's own words faster than we can mislabel them.
   */
  readonly notes: readonly string[];
  readonly status: EntryStatus;
  /** The cell's full text, so the UI can always fall back to what was written. */
  readonly raw: string;
  readonly row: number;
  readonly column: number;
}

export type DiagnosticCode =
  | 'NO_LEGEND'
  | 'NO_SLOT_HEADER'
  | 'UNKNOWN_COLOUR'
  | 'AMBIGUOUS_COLOUR'
  | 'UNREADABLE_TIME'
  | 'UNPARSED_CELL';

/**
 * A problem found while parsing. Diagnostics exist so a sync can refuse to
 * publish a day that parsed badly, instead of shipping a confidently empty
 * timetable -- the failure mode that would actually make a student miss a class.
 */
export interface ParseDiagnostic {
  readonly code: DiagnosticCode;
  readonly detail: string;
  /** Position of the first occurrence. */
  readonly row: number | null;
  readonly column: number | null;
  /**
   * How many cells produced this same problem. Identical diagnostics are folded
   * together because one tab repeats `FYP/Thesis Evaluations` across a hundred
   * and twenty cells, and a reviewer needs the list of distinct problems rather
   * than a count dominated by one benign block.
   */
  readonly occurrences: number;
}

export interface TimetableDay {
  readonly weekday: Weekday;
  /**
   * The tab's own heading for the day, verbatim. Usually just `Monday`, but the
   * sheet also uses it to say things that change where a student has to be --
   * `Friday ONLINE` -- so it is carried through rather than normalised away.
   */
  readonly dayLabel: string;
  readonly entries: readonly TimetableEntry[];
  /**
   * Every room the tab lists down its room columns, in the order printed.
   *
   * Taken from the sheet rather than from the entries, because a room with no
   * class in it all day has no entries at all -- and that is precisely the room
   * somebody looking for an empty one wants to hear about.
   */
  readonly rooms: readonly string[];
  /** The legend as parsed from this tab, keyed by lowercase hex colour. */
  readonly legend: ReadonlyMap<string, readonly Cohort[]>;
  readonly diagnostics: readonly ParseDiagnostic[];
}
