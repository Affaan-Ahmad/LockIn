import type { MinuteOfDay, Weekday } from './types';

/**
 * Turning an instant into a position in the timetable.
 *
 * "Which rooms are free right now" needs two things the timetable does not
 * carry: which weekday it is, and how many minutes into the day we are. Both
 * depend on a time zone, and picking the wrong one silently shifts every answer.
 *
 * **Not the spreadsheet's zone.** The document declares
 * `America/Los_Angeles` -- a default nobody changed. Believing it would put the
 * campus twelve hours out.
 *
 * **Not the viewer's zone either.** The timetable is a statement about where
 * people physically are, so the hour that matters is the hour on campus. A
 * student checking from another country still wants to know whether a room in
 * Islamabad is free now, not what time it is where they are sitting.
 */

/** Where the timetable's classes physically happen. */
export const CAMPUS_TIME_ZONE = 'Asia/Karachi';

export interface TimetableMoment {
  /** Null on Sunday, the one day no published document has ever carried. */
  readonly weekday: Weekday | null;
  readonly minuteOfDay: MinuteOfDay;
  /** The zone the reading was taken in, so a caller can say so. */
  readonly timeZone: string;
}

const WEEKDAY_BY_NAME: ReadonlyMap<string, Weekday> = new Map([
  ['Monday', 'MONDAY'],
  ['Tuesday', 'TUESDAY'],
  ['Wednesday', 'WEDNESDAY'],
  ['Thursday', 'THURSDAY'],
  ['Friday', 'FRIDAY'],
  ['Saturday', 'SATURDAY'],
]);

/**
 * Reads an instant as a weekday and a minute of the day, on campus.
 *
 * Uses the runtime's own zone database rather than a fixed offset, so it stays
 * correct if the region ever observes daylight saving again.
 */
export function toTimetableMoment(
  instant: Date,
  timeZone: string = CAMPUS_TIME_ZONE,
): TimetableMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const valueOf = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  // `hour12: false` renders midnight as 24 in some runtimes.
  const hour = Number.parseInt(valueOf('hour'), 10) % 24;
  const minute = Number.parseInt(valueOf('minute'), 10);
  const weekday = WEEKDAY_BY_NAME.get(valueOf('weekday')) ?? null;

  return {
    weekday,
    minuteOfDay: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
    timeZone,
  };
}

/**
 * The window to ask a room about, given "now".
 *
 * A room that is empty this second but has a class starting in four minutes is
 * not somewhere to sit down, so the question is really "free for the next
 * little while". Half an hour is the default because it is about the shortest
 * span worth walking to a room for.
 */
export function windowFrom(minuteOfDay: MinuteOfDay, forMinutes = 30) {
  return { startMinute: minuteOfDay, endMinute: minuteOfDay + Math.max(1, forMinutes) };
}
