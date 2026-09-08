import type { MinuteOfDay, TimeRange } from './types';

/**
 * The sheet writes every time on a 12-hour clock with no am/pm marker:
 * `08:30-09:50`, then `01:00-02:20`, then `06:45-08:05`. Read literally the day
 * would run backwards at lunchtime, so the meridiem has to be recovered.
 *
 * The rule is the teaching day itself, which runs from 08:30 to 20:05:
 * hours 8 to 12 are morning as written, hours 1 to 7 are afternoon.
 *
 * That rule alone is not sufficient, and the case that breaks it is real: the
 * last evening slot is written `06:45-08:05`, meaning 18:45 to 20:05. Read time
 * by time, the end lands in the morning and the slot runs backwards. So a range
 * gets a second, stronger rule applied on top -- **a published range moves
 * forwards** -- and an end that would precede its start is pushed on by twelve
 * hours. Both rules together are checked by `slotsAreChronological` against the
 * header row of every tab.
 *
 * A time carrying an explicit `am`/`pm` is believed over either rule, and an
 * hour of 13 or more is already 24-hour and passes through. Anything else
 * returns null: a class with no readable time is shown without one, never with
 * an invented one.
 */

const MORNING_FLOOR_HOUR = 8;
const MINUTES_IN_HALF_DAY = 12 * 60;
const MINUTES_IN_DAY = 24 * 60;

export function resolveMinuteOfDay(
  hour: number,
  minute: number,
  meridiem: 'am' | 'pm' | null = null,
): MinuteOfDay | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  if (meridiem !== null) {
    if (hour < 1 || hour > 12) return null;
    const base = hour % 12;
    return (meridiem === 'pm' ? base + 12 : base) * 60 + minute;
  }

  // Already unambiguous on a 24-hour clock.
  if (hour >= 13 && hour <= 23) return hour * 60 + minute;
  // Morning, as written. 12 is noon and also stands as written.
  if (hour >= MORNING_FLOOR_HOUR && hour <= 12) return hour * 60 + minute;
  // 1 through 7 can only be afternoon in a day that starts at half past eight.
  if (hour >= 1 && hour <= 7) return (hour + 12) * 60 + minute;
  return null;
}

const TIME = String.raw`(\d{1,2}):(\d{2})\s*(am|pm)?`;
const DASH = String.raw`\s*[-–—]\s*`;

/** Exported so a caller can strip a range from a string after reading it. */
export const TIME_RANGE_PATTERN = new RegExp(TIME + DASH + TIME, 'i');
const RANGE = TIME_RANGE_PATTERN;

const meridiemOf = (value: string | undefined): 'am' | 'pm' | null => {
  const lower = value?.toLowerCase();
  return lower === 'am' || lower === 'pm' ? lower : null;
};

/**
 * Reads the first `HH:MM-HH:MM` range in a string.
 *
 * Returns null when the range does not move forwards. That happens on genuinely
 * malformed input, and a range whose end precedes its start would otherwise
 * render as a class of negative length or, worse, one that looks like it has
 * already finished.
 */
export function parseTimeRange(text: string): TimeRange | null {
  const match = RANGE.exec(text);
  if (match === null) return null;

  const startMinute = resolveMinuteOfDay(
    Number.parseInt(match[1] ?? '', 10),
    Number.parseInt(match[2] ?? '', 10),
    meridiemOf(match[3]),
  );
  const endMinute = resolveMinuteOfDay(
    Number.parseInt(match[4] ?? '', 10),
    Number.parseInt(match[5] ?? '', 10),
    meridiemOf(match[6]),
  );

  if (startMinute === null || endMinute === null) return null;
  if (endMinute > startMinute) return { startMinute, endMinute };

  // The range runs backwards. When the end carried no explicit meridiem, the
  // per-time rule read an evening hour as a morning one -- `06:45-08:05` is
  // 18:45 to 20:05 -- and moving it on by twelve hours is the only reading that
  // goes forwards. If that still does not, the range is genuinely unreadable.
  if (meridiemOf(match[6]) === null) {
    const corrected = endMinute + MINUTES_IN_HALF_DAY;
    if (corrected > startMinute && corrected < MINUTES_IN_DAY) {
      return { startMinute, endMinute: corrected };
    }
  }
  return null;
}

/** True when the text contains a range at all, whether or not it is coherent. */
export function containsTimeRange(text: string): boolean {
  return RANGE.test(text);
}

/**
 * `Extended till ...` is written more loosely than the grid's own times: the
 * sheet has `02:00`, `05:15pm`, and also `2 pm` with no minutes at all. The
 * minutes are therefore optional here, where in a published range they are not.
 */
const LOOSE_TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;

/** Exported for the same reason as {@link TIME_RANGE_PATTERN}. */
export const EXTENDED_UNTIL_PATTERN = new RegExp(
  String.raw`extended\s+(?:till|until|to)\s+${LOOSE_TIME}`,
  'i',
);
const EXTENDED = EXTENDED_UNTIL_PATTERN;

/**
 * Reads `Extended till 02:00` / `Extended till 05:15pm`.
 *
 * This is the teacher adding time to one occurrence, and it is the difference
 * between leaving at 03:50 and leaving at 05:15. It is kept apart from the
 * range because it moves only the end.
 */
export function parseExtendedUntil(text: string): MinuteOfDay | null {
  const match = EXTENDED.exec(text);
  if (match === null) return null;
  // Minutes are optional: `Extended till 2 pm` means the hour exactly.
  const minutes = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  return resolveMinuteOfDay(Number.parseInt(match[1] ?? '', 10), minutes, meridiemOf(match[3]));
}

/** True when a tab's slot headers run forwards, which validates the meridiem rule. */
export function slotsAreChronological(ranges: readonly TimeRange[]): boolean {
  return ranges.every(
    (range, index) => index === 0 || range.startMinute >= (ranges[index - 1]?.startMinute ?? 0),
  );
}

/** `525` -> `08:45`. The 24-hour rendering; presentation may localise it. */
export function formatMinuteOfDay(minute: MinuteOfDay): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
