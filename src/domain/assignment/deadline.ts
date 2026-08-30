/**
 * Deadline value objects.
 *
 * Google Classroom returns a due date and a due time as two independent,
 * separately-optional fields, **both expressed in UTC**. Two mistakes are
 * common and both are silent:
 *
 *  1. Treating dueDate/dueTime as the teacher's local time. That shifts every
 *     deadline by the UTC offset -- up to a full day near midnight.
 *  2. Filling in a missing dueTime with 23:59. Classroom genuinely allows a
 *     due date with no time, and inventing one manufactures a deadline the
 *     student was never given.
 *
 * So precision is part of the type. An item with a date and no time is
 * DATE_ONLY and carries no instant at all; nothing downstream can accidentally
 * render it as a time, because there is no time to render.
 */

export type DuePrecision = 'EXACT' | 'DATE_ONLY' | 'NONE';

/** A UTC calendar date exactly as Google supplied it. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** A UTC wall-clock time exactly as Google supplied it. */
export interface ClockTime {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

export interface Deadline {
  readonly precision: DuePrecision;
  readonly dueDate: CalendarDate | null;
  readonly dueTime: ClockTime | null;
  /** Set only when precision is EXACT. Never derived from a date alone. */
  readonly dueAt: Date | null;
}

export const NO_DEADLINE: Deadline = {
  precision: 'NONE',
  dueDate: null,
  dueTime: null,
  dueAt: null,
};

export type DeadlineResolution =
  | { readonly ok: true; readonly deadline: Deadline }
  | { readonly ok: false; readonly issue: string };

export interface GoogleDueDateInput {
  readonly year?: number | null | undefined;
  readonly month?: number | null | undefined;
  readonly day?: number | null | undefined;
}

export interface GoogleDueTimeInput {
  readonly hours?: number | null | undefined;
  readonly minutes?: number | null | undefined;
  readonly seconds?: number | null | undefined;
}

/**
 * Extension point for deadlines that do not come from a structured field --
 * "submit by Friday 5pm" written in a description, a university LMS with its
 * own format, a calendar event. Registering a strategy must not require
 * touching the Google mapping below.
 */
export interface DeadlineExtractionStrategy {
  readonly id: string;
  extract(input: { title: string; description: string | null }): Deadline | null;
}

/**
 * Maps Google's two optional fields to a Deadline.
 *
 * Returns `ok: false` rather than a best guess when the components are present
 * but nonsensical, so the caller can record a mapping issue and keep the
 * previous known-good value instead of overwriting it with garbage.
 */
export function resolveGoogleDeadline(
  dueDate: GoogleDueDateInput | null | undefined,
  dueTime: GoogleDueTimeInput | null | undefined,
): DeadlineResolution {
  const date = normalizeDate(dueDate);
  if (date === 'invalid') return { ok: false, issue: 'dueDate present but not a valid calendar date' };

  if (date === null) {
    // A time without a date cannot be placed on the calendar. Classroom should
    // not emit this; if it does, refuse rather than pick a day.
    if (normalizeTime(dueTime) !== null) {
      return { ok: false, issue: 'dueTime present without dueDate; cannot place on the calendar' };
    }
    return { ok: true, deadline: NO_DEADLINE };
  }

  const time = normalizeTime(dueTime);
  if (time === 'invalid') return { ok: false, issue: 'dueTime present but not a valid time of day' };

  if (time === null) {
    return {
      ok: true,
      deadline: { precision: 'DATE_ONLY', dueDate: date, dueTime: null, dueAt: null },
    };
  }

  const instant = new Date(
    Date.UTC(date.year, date.month - 1, date.day, time.hours, time.minutes, time.seconds, 0),
  );
  if (Number.isNaN(instant.getTime())) {
    return { ok: false, issue: 'dueDate and dueTime did not combine into a valid instant' };
  }

  return { ok: true, deadline: { precision: 'EXACT', dueDate: date, dueTime: time, dueAt: instant } };
}

/**
 * Ordering key for lists that mix exact and date-only deadlines.
 *
 * A DATE_ONLY item sorts at the *start* of its UTC day. This is a sort key and
 * nothing else: it must never be shown to a student as a deadline, because the
 * student was not given a time. The database mirrors this as a generated column
 * with the same rule so ordering is identical in SQL and in memory.
 */
export function deadlineSortKey(deadline: Deadline): Date | null {
  if (deadline.dueAt !== null) return deadline.dueAt;
  if (deadline.dueDate === null) return null;
  const { year, month, day } = deadline.dueDate;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export interface ZonedDeadlineParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly timeZone: string;
}

/**
 * Renders an exact deadline in the student's own timezone.
 *
 * Returns null for anything that is not EXACT, so a DATE_ONLY deadline can
 * never acquire a fabricated wall-clock time by passing through a formatter.
 * Uses Intl rather than manual offset arithmetic because only Intl knows when
 * a zone changed its rules or crossed a DST boundary.
 */
export function deadlineInTimeZone(
  deadline: Deadline,
  timeZone: string,
): ZonedDeadlineParts | null {
  if (deadline.precision !== 'EXACT' || deadline.dueAt === null) return null;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = new Map<string, string>(
    formatter.formatToParts(deadline.dueAt).map((part) => [part.type as string, part.value]),
  );

  const read = (key: string): number => Number(parts.get(key) ?? '0');
  // Intl renders midnight as hour 24 in some locales/zones; normalise it.
  const hour = read('hour') % 24;

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    timeZone,
  };
}

/** The UTC calendar date, as an ISO `YYYY-MM-DD` string, for persistence. */
export function calendarDateToIso(date: CalendarDate): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** The UTC time of day, as an ISO `HH:MM:SS` string, for persistence. */
export function clockTimeToIso(time: ClockTime): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(time.hours)}:${pad(time.minutes)}:${pad(time.seconds)}`;
}

function normalizeDate(input: GoogleDueDateInput | null | undefined): CalendarDate | null | 'invalid' {
  if (input === null || input === undefined) return null;
  const { year, month, day } = input;
  if (year === null || year === undefined) return null;
  if (month === null || month === undefined) return null;
  if (day === null || day === undefined) return null;

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return 'invalid';
  if (year < 1900 || year > 2999) return 'invalid';
  if (month < 1 || month > 12) return 'invalid';
  if (day < 1 || day > 31) return 'invalid';

  // Rejects 31 February and friends: round-tripping through Date.UTC changes
  // the day for an out-of-range value.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return 'invalid';
  }

  return { year, month, day };
}

function normalizeTime(input: GoogleDueTimeInput | null | undefined): ClockTime | null | 'invalid' {
  if (input === null || input === undefined) return null;

  const hours = input.hours ?? 0;
  const minutes = input.minutes ?? 0;
  const seconds = input.seconds ?? 0;

  // Classroom omits zero-valued components, so an all-absent object is not a
  // time at all -- it is the absence of one, and must not become 00:00.
  const hasAny =
    (input.hours ?? null) !== null ||
    (input.minutes ?? null) !== null ||
    (input.seconds ?? null) !== null;
  if (!hasAny) return null;

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    return 'invalid';
  }
  if (hours < 0 || hours > 23) return 'invalid';
  if (minutes < 0 || minutes > 59) return 'invalid';
  if (seconds < 0 || seconds > 59) return 'invalid';

  return { hours, minutes, seconds };
}
