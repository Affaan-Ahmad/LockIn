import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIME_FORMAT,
  formatClock,
  isTimeFormat,
  toIsoTime,
  type TimeFormat,
} from '@/lib/clock';
import { formatMinuteOfDay } from '@/domain/timetable/time-of-day';
import { formatDeadline, type ApiDeadline } from '@/lib/format';

/**
 * How a time of day is written on screen.
 *
 * Kept apart from the parser's own `formatMinuteOfDay`, which stays a plain
 * 24-hour rendering because that is what tests and machine-readable attributes
 * need. This is the presentation layer, and it is the only thing a student's
 * preference is allowed to change.
 */

const at = (hour: number, minute: number): number => hour * 60 + minute;

describe('writing a time the way it was asked for', () => {
  const cases: ReadonlyArray<readonly [minute: number, twelve: string, twentyFour: string]> = [
    [at(8, 30), '8:30 am', '08:30'],
    [at(9, 50), '9:50 am', '09:50'],
    [at(11, 30), '11:30 am', '11:30'],
    [at(13, 0), '1:00 pm', '13:00'],
    [at(14, 20), '2:20 pm', '14:20'],
    [at(17, 15), '5:15 pm', '17:15'],
    [at(20, 5), '8:05 pm', '20:05'],
  ];

  it.each(cases)('renders %i as %s and %s', (minute, twelve, twentyFour) => {
    expect(formatClock(minute, '12')).toBe(twelve);
    expect(formatClock(minute, '24')).toBe(twentyFour);
  });

  /**
   * Noon and midnight are where a twelve-hour clock goes wrong if it is written
   * by hand: hour 12 becomes 0, or midnight becomes 12 pm.
   */
  it('gets noon and midnight right', () => {
    expect(formatClock(at(12, 0), '12')).toBe('12:00 pm');
    expect(formatClock(at(0, 0), '12')).toBe('12:00 am');
    expect(formatClock(at(12, 0), '24')).toBe('12:00');
    expect(formatClock(at(0, 0), '24')).toBe('00:00');
  });

  it('defaults to the twelve-hour clock the rest of the product already uses', () => {
    expect(DEFAULT_TIME_FORMAT).toBe('12');
    expect(formatClock(at(14, 30))).toBe(formatClock(at(14, 30), '12'));
  });

  /**
   * The minute count is already campus wall-clock time. Formatting it in any
   * zone but UTC would apply an offset a second time and move every class.
   */
  it('does not shift a time by the machine\'s own time zone', () => {
    for (const minute of [at(8, 30), at(13, 0), at(20, 5)]) {
      expect(toIsoTime(minute)).toBe(formatClock(minute, '24'));
    }
  });

  it('agrees with the parser\'s canonical rendering in 24-hour mode', () => {
    for (const minute of [at(8, 30), at(11, 20), at(15, 55), at(18, 45)]) {
      expect(formatClock(minute, '24')).toBe(formatMinuteOfDay(minute));
    }
  });

  it('survives a nonsense minute rather than rendering NaN', () => {
    expect(formatClock(Number.NaN, '24')).toBe('00:00');
    expect(formatClock(-5, '24')).toBe('00:00');
    expect(toIsoTime(Number.NaN)).toBe('00:00');
  });
});

describe('reading a stored preference', () => {
  it('accepts only the two values it writes', () => {
    expect(isTimeFormat('12')).toBe(true);
    expect(isTimeFormat('24')).toBe(true);
  });

  /**
   * The value arrives from a cookie, which anyone can edit. A rejected value
   * has to fall back to the default rather than reaching `Intl`.
   */
  it('rejects anything else, however plausible', () => {
    for (const value of ['12h', '24-hour', 'twelve', '', null, undefined, 12, {}]) {
      expect(isTimeFormat(value)).toBe(false);
    }
  });

  it('is exhaustive over the type', () => {
    const all: readonly TimeFormat[] = ['12', '24'];
    for (const value of all) expect(isTimeFormat(value)).toBe(true);
  });
});

describe('the same preference reaches a deadline', () => {
  // 14:30 in Karachi is 09:30 UTC.
  const deadline: ApiDeadline = {
    precision: 'EXACT',
    dueAtUtc: '2026-09-10T09:30:00.000Z',
    dueDateUtc: '2026-09-10',
  };
  const now = new Date('2026-09-09T06:00:00.000Z');
  const timeZone = 'Asia/Karachi';

  it('writes a due time on whichever clock was chosen', () => {
    expect(formatDeadline(deadline, now, timeZone, '12').time).toBe('2:30 pm');
    expect(formatDeadline(deadline, now, timeZone, '24').time).toBe('14:30');
  });

  /**
   * The parameter was added after the fact, so a caller that has not been
   * updated must render exactly as it did before -- twelve-hour.
   */
  it('keeps its original behaviour when nobody passes a preference', () => {
    expect(formatDeadline(deadline, now, timeZone).time).toBe(
      formatDeadline(deadline, now, timeZone, '12').time,
    );
  });

  it('agrees with the timetable, which was the point of the exercise', () => {
    const asDeadline = formatDeadline(deadline, now, timeZone, '24').time;
    expect(asDeadline).toBe(formatClock(14 * 60 + 30, '24'));
    expect(formatDeadline(deadline, now, timeZone, '12').time).toBe(formatClock(14 * 60 + 30, '12'));
  });

  it('still says so in words when a deadline has no time', () => {
    const dateOnly: ApiDeadline = {
      precision: 'DATE_ONLY',
      dueAtUtc: null,
      dueDateUtc: '2026-09-10',
    };
    expect(formatDeadline(dateOnly, now, timeZone, '24').time).toBe('No time given');
  });
});
