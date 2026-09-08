/**
 * How a time of day is written on screen.
 *
 * The timetable's own document uses a twelve-hour clock with no am/pm marker,
 * which is why the parser resolves everything to minutes since midnight and
 * keeps `formatMinuteOfDay` as a plain 24-hour rendering: unambiguous, and the
 * right thing for a test to assert against. What a student should *see* is a
 * separate question, and this is where it is answered.
 *
 * The default is twelve-hour because that is what the rest of the product
 * already does -- a deadline has always read "2:30 pm" -- and a timetable
 * beside it reading "14:30" was the app disagreeing with itself.
 *
 * Deliberately free of `server-only` and of any Next import: the same rendering
 * has to happen in a Server Component drawing the day's list and in the Client
 * Component that asks which rooms are free.
 */

export type TimeFormat = '12' | '24';

/** Set only when a student changes it, so "unset" and "twelve-hour" differ. */
export const TIME_FORMAT_COOKIE = 'lockin_time_format';

export const DEFAULT_TIME_FORMAT: TimeFormat = '12';

export function isTimeFormat(value: unknown): value is TimeFormat {
  return value === '12' || value === '24';
}

/**
 * A day's minute count, written the way the student asked for.
 *
 * Rendered through `Intl` rather than by hand so it matches the deadline
 * formatter exactly -- both produce "2:30 pm" from the same locale rules -- and
 * so the am/pm marker follows the locale instead of being hard-coded.
 *
 * The instant is built at UTC midnight and formatted in UTC. The minute count
 * is already local wall-clock time on campus; converting it again would shift
 * every class by the offset between the campus and wherever this runs.
 */
export function formatClock(minuteOfDay: number, format: TimeFormat = DEFAULT_TIME_FORMAT): string {
  const safe = Number.isFinite(minuteOfDay) ? Math.max(0, Math.round(minuteOfDay)) : 0;
  const instant = new Date(Date.UTC(2000, 0, 1) + safe * 60_000);

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: format === '12' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: format === '12',
  }).format(instant);
}

/**
 * A span of time, written as one phrase.
 *
 * On a twelve-hour clock the marker is said once when both ends share it --
 * "8:30-11:15 am" rather than "8:30 am-11:15 am". That is how a person writes a
 * range, and it keeps the column narrow enough not to wrap, which is what
 * repeating it did.
 */
export function formatClockRange(
  startMinute: number,
  endMinute: number,
  format: TimeFormat = DEFAULT_TIME_FORMAT,
): string {
  const start = formatClock(startMinute, format);
  const end = formatClock(endMinute, format);
  if (format === '24') return `${start}–${end}`;

  const marker = /\s(am|pm)$/i.exec(start)?.[1];
  const sharesMarker = marker !== undefined && end.toLowerCase().endsWith(marker.toLowerCase());
  return sharesMarker
    ? `${start.replace(/\s(am|pm)$/i, '')}–${end}`
    : `${start}–${end}`;
}

/** `08:30` / `8:30 am` for a machine-readable `datetime` attribute. */
export function toIsoTime(minuteOfDay: number): string {
  const safe = Number.isFinite(minuteOfDay) ? Math.max(0, Math.round(minuteOfDay)) : 0;
  const hours = Math.floor(safe / 60) % 24;
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
