import { describe, expect, it } from 'vitest';

import {
  calendarDateToIso,
  clockTimeToIso,
  deadlineInTimeZone,
  deadlineSortKey,
  resolveGoogleDeadline,
} from '@/domain/assignment/deadline';

/**
 * Deadline handling is the second place (after classification) where being
 * quietly wrong costs a student a grade. Google returns dueDate and dueTime as
 * two separately-optional fields, both in UTC, and both of those facts are easy
 * to get wrong in a way no runtime error reveals.
 */

describe('resolveGoogleDeadline', () => {
  it('treats a date and time as UTC, not local', () => {
    const result = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 14 },
      { hours: 23, minutes: 59, seconds: 0 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadline.precision).toBe('EXACT');
    // Interpreting these as local time would shift the instant by the host
    // offset -- on a machine in UTC+5 this assertion is what catches it.
    expect(result.deadline.dueAt?.toISOString()).toBe('2026-03-14T23:59:00.000Z');
  });

  it('produces DATE_ONLY with no instant when Google gave no time', () => {
    const result = resolveGoogleDeadline({ year: 2026, month: 3, day: 14 }, undefined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadline.precision).toBe('DATE_ONLY');
    expect(result.deadline.dueDate).toEqual({ year: 2026, month: 3, day: 14 });
    // The single most important assertion in this file: no invented 23:59.
    expect(result.deadline.dueAt).toBeNull();
    expect(result.deadline.dueTime).toBeNull();
  });

  it('produces NONE when Google gave neither', () => {
    const result = resolveGoogleDeadline(undefined, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadline).toEqual({
      precision: 'NONE',
      dueDate: null,
      dueTime: null,
      dueAt: null,
    });
  });

  it('treats an all-absent dueTime object as no time at all', () => {
    // Classroom omits zero-valued components, so `{}` is not midnight.
    const result = resolveGoogleDeadline({ year: 2026, month: 3, day: 14 }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadline.precision).toBe('DATE_ONLY');
  });

  it('keeps an explicit midnight as an exact deadline', () => {
    const result = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 14 },
      { hours: 0, minutes: 0, seconds: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadline.precision).toBe('EXACT');
    expect(result.deadline.dueAt?.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('fills omitted minute and second components of a partial time', () => {
    const result = resolveGoogleDeadline({ year: 2026, month: 3, day: 14 }, { hours: 17 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadline.dueAt?.toISOString()).toBe('2026-03-14T17:00:00.000Z');
  });

  it.each([
    [{ year: 2026, month: 2, day: 31 }, 'a date that does not exist'],
    [{ year: 2026, month: 13, day: 1 }, 'a month out of range'],
    [{ year: 2026, month: 0, day: 1 }, 'a zero month'],
    [{ year: 1700, month: 1, day: 1 }, 'an implausible year'],
  ] as const)('rejects %j (%s)', (dueDate, _why) => {
    const result = resolveGoogleDeadline(dueDate, undefined);
    expect(result.ok).toBe(false);
  });

  it('rejects a time out of range rather than clamping it', () => {
    const result = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 14 },
      { hours: 25, minutes: 0 },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a time with no date rather than picking a day', () => {
    const result = resolveGoogleDeadline(undefined, { hours: 17, minutes: 0 });
    expect(result.ok).toBe(false);
  });

  it('accepts a leap day', () => {
    const result = resolveGoogleDeadline({ year: 2028, month: 2, day: 29 }, undefined);
    expect(result.ok).toBe(true);
  });

  it('rejects a leap day in a non-leap year', () => {
    const result = resolveGoogleDeadline({ year: 2026, month: 2, day: 29 }, undefined);
    expect(result.ok).toBe(false);
  });
});

describe('deadlineSortKey', () => {
  it('uses the exact instant when one exists', () => {
    const result = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 14 },
      { hours: 17, minutes: 30 },
    );
    if (!result.ok) throw new Error('setup');
    expect(deadlineSortKey(result.deadline)?.toISOString()).toBe('2026-03-14T17:30:00.000Z');
  });

  it('sorts a date-only deadline at the start of its UTC day', () => {
    const result = resolveGoogleDeadline({ year: 2026, month: 3, day: 14 }, undefined);
    if (!result.ok) throw new Error('setup');

    // A sort key, never a displayed deadline. The database generates the same
    // value with the same rule so ordering matches in SQL and in memory.
    expect(deadlineSortKey(result.deadline)?.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('has no key when there is no deadline', () => {
    const result = resolveGoogleDeadline(undefined, undefined);
    if (!result.ok) throw new Error('setup');
    expect(deadlineSortKey(result.deadline)).toBeNull();
  });
});

describe('deadlineInTimeZone', () => {
  it('renders an exact deadline in the student timezone', () => {
    const result = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 14 },
      { hours: 18, minutes: 59 },
    );
    if (!result.ok) throw new Error('setup');

    // Pakistan is UTC+5 year round: 18:59Z is 23:59 local, same day.
    expect(deadlineInTimeZone(result.deadline, 'Asia/Karachi')).toMatchObject({
      year: 2026,
      month: 3,
      day: 14,
      hour: 23,
      minute: 59,
    });
  });

  it('moves the local date when the instant crosses midnight', () => {
    const result = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 14 },
      { hours: 20, minutes: 0 },
    );
    if (!result.ok) throw new Error('setup');

    // 20:00Z on the 14th is 01:00 on the 15th in Karachi. A student shown the
    // 14th here would think they had an extra day.
    expect(deadlineInTimeZone(result.deadline, 'Asia/Karachi')).toMatchObject({
      day: 15,
      hour: 1,
    });
  });

  it('applies the correct offset either side of a DST transition', () => {
    // Europe/London springs forward at 01:00 UTC on 2026-03-29.
    const before = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 29 },
      { hours: 0, minutes: 30 },
    );
    const after = resolveGoogleDeadline(
      { year: 2026, month: 3, day: 29 },
      { hours: 1, minutes: 30 },
    );
    if (!before.ok || !after.ok) throw new Error('setup');

    expect(deadlineInTimeZone(before.deadline, 'Europe/London')).toMatchObject({
      hour: 0,
      minute: 30,
    });
    // Same UTC day, one hour later, but the local clock jumped two hours.
    expect(deadlineInTimeZone(after.deadline, 'Europe/London')).toMatchObject({
      hour: 2,
      minute: 30,
    });
  });

  it('handles the autumn transition where a local hour repeats', () => {
    // Europe/London falls back at 02:00 local on 2026-10-25 (01:00 UTC).
    const first = resolveGoogleDeadline(
      { year: 2026, month: 10, day: 25 },
      { hours: 0, minutes: 30 },
    );
    const second = resolveGoogleDeadline(
      { year: 2026, month: 10, day: 25 },
      { hours: 1, minutes: 30 },
    );
    if (!first.ok || !second.ok) throw new Error('setup');

    // Both render as 01:30 local; storing UTC is what keeps them distinct.
    expect(deadlineInTimeZone(first.deadline, 'Europe/London')).toMatchObject({ hour: 1, minute: 30 });
    expect(deadlineInTimeZone(second.deadline, 'Europe/London')).toMatchObject({ hour: 1, minute: 30 });
    expect(first.deadline.dueAt?.getTime()).not.toBe(second.deadline.dueAt?.getTime());
  });

  it('refuses to render a date-only deadline in any timezone', () => {
    const result = resolveGoogleDeadline({ year: 2026, month: 3, day: 14 }, undefined);
    if (!result.ok) throw new Error('setup');

    // The critical guard: a formatter must not be able to manufacture a
    // wall-clock time for a deadline that never had one.
    expect(deadlineInTimeZone(result.deadline, 'Asia/Karachi')).toBeNull();
  });

  it('returns null when there is no deadline at all', () => {
    const result = resolveGoogleDeadline(undefined, undefined);
    if (!result.ok) throw new Error('setup');
    expect(deadlineInTimeZone(result.deadline, 'UTC')).toBeNull();
  });
});

describe('persistence formatting', () => {
  it('pads calendar dates and clock times', () => {
    expect(calendarDateToIso({ year: 2026, month: 3, day: 4 })).toBe('2026-03-04');
    expect(clockTimeToIso({ hours: 9, minutes: 5, seconds: 0 })).toBe('09:05:00');
  });
});
