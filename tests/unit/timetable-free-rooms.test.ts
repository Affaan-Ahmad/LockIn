import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { freeRooms, occupiedUntil, roomAvailability, roomSchedule } from '@/domain/timetable/free-rooms';
import { CAMPUS_TIME_ZONE, toTimetableMoment, windowFrom } from '@/domain/timetable/now';
import { parseTimetableDay } from '@/domain/timetable/parse-day';
import type { TimetableDay, Weekday } from '@/domain/timetable/types';

/**
 * "Which rooms are empty right now."
 *
 * The answer is the inverse of the timetable, and an inverse is only as good as
 * the set it is taken against: the rooms come from the sheet's own room columns,
 * not from the classes, or a room with nothing booked in it would never be
 * offered. The other half is that "I don't know" must not collapse into "free" --
 * sending somebody to a room that turns out to be occupied is worse than
 * admitting we cannot tell.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/timetable/${name}.html`, import.meta.url)), 'utf8');

const DAYS: ReadonlyArray<readonly [file: string, weekday: Weekday]> = [
  ['monday', 'MONDAY'],
  ['tuesday', 'TUESDAY'],
  ['wednesday', 'WEDNESDAY'],
  ['thursday', 'THURSDAY'],
  ['friday', 'FRIDAY'],
];

const dayFor = (file: string, weekday: Weekday): TimetableDay =>
  parseTimetableDay(fixture(file), weekday);

const monday = dayFor('monday', 'MONDAY');
const at = (hour: number, minute: number): number => hour * 60 + minute;
const span = (fromHour: number, fromMinute: number, toHour: number, toMinute: number) => ({
  startMinute: at(fromHour, fromMinute),
  endMinute: at(toHour, toMinute),
});

describe('the room list the answer is drawn from', () => {
  it.each(DAYS)('%s lists real rooms and nothing else', (file, weekday) => {
    const day = dayFor(file, weekday);

    expect(day.rooms.length).toBeGreaterThan(40);
    // The published export puts a row of spreadsheet column letters and the
    // day's own title in the same columns as the room names.
    expect(day.rooms).not.toContain('A');
    expect(day.rooms).not.toContain('AE');
    expect(day.rooms).not.toContain(day.dayLabel);
    for (const room of day.rooms) expect(room).not.toMatch(/^\d+$/);
  });

  /**
   * The property that makes the inverse trustworthy: if a class is in a room,
   * that room is in the list. Otherwise a busy room could be missing from the
   * set entirely and never be reported as busy.
   */
  it.each(DAYS)('%s lists every room a class is actually in', (file, weekday) => {
    const day = dayFor(file, weekday);
    const used = new Set(day.entries.map((entry) => entry.room).filter((room) => room !== ''));
    const missing = [...used].filter((room) => !day.rooms.includes(room));

    expect(missing).toEqual([]);
  });

  it.each(DAYS)('%s answers for every room exactly once', (file, weekday) => {
    const day = dayFor(file, weekday);
    const statuses = roomAvailability(day, span(11, 0, 11, 50));

    expect(statuses).toHaveLength(day.rooms.length);
    expect(new Set(statuses.map((status) => status.room)).size).toBe(day.rooms.length);
  });
});

describe('a room is free only when it really is', () => {
  /**
   * The load-bearing check, and the one that would catch a placement or
   * overlap error: for every room reported free, no scheduled class in that
   * room may touch the window. Derived from the entries independently of the
   * availability code.
   */
  it.each(DAYS)('%s never calls a room free while a class runs in it', (file, weekday) => {
    const day = dayFor(file, weekday);
    const windows = [
      span(8, 30, 9, 50), span(10, 0, 11, 20), span(11, 30, 12, 50),
      span(13, 0, 14, 20), span(14, 30, 15, 50), span(17, 20, 18, 40),
    ];

    for (const window of windows) {
      for (const status of freeRooms(day, window)) {
        for (const entry of roomSchedule(day, status.room)) {
          if (entry.status !== 'SCHEDULED' || entry.time === null) continue;
          const until = occupiedUntil(entry) ?? entry.time.endMinute;
          const clashes = entry.time.startMinute < window.endMinute && window.startMinute < until;
          expect(clashes, `${weekday} ${status.room} vs ${entry.raw}`).toBe(false);
        }
      }
    }
  });

  it('reports a room with a class in it as occupied, and says which', () => {
    const status = roomAvailability(monday, span(8, 30, 9, 50)).find((s) => s.room === 'C-301');

    expect(status?.availability).toBe('OCCUPIED');
    expect(status?.conflicting.map((entry) => entry.raw)).toContain('OOP (CS-A)');
  });

  /**
   * An extension moves only the end, so a class written `11:30-01:15 Extended
   * till 02:00` holds its room for another forty-five minutes. Ignoring that
   * empties the room while someone is still teaching in it.
   */
  it('keeps a room occupied for the length of an extension', () => {
    const during = roomAvailability(monday, span(13, 20, 13, 40)).find((s) => s.room === 'C-305');
    const after = roomAvailability(monday, span(14, 5, 14, 20)).find((s) => s.room === 'C-305');

    // The class's own end is 13:15; the extension runs to 14:00.
    expect(during?.availability).toBe('OCCUPIED');
    expect(after?.availability).toBe('FREE');
  });

  it('treats a cancelled class as freeing the room, and says why', () => {
    const friday = dayFor('friday', 'FRIDAY');
    const status = roomAvailability(friday, span(11, 30, 12, 30)).find((s) => s.room === 'C-304');

    expect(status?.availability).toBe('FREE');
    expect(status?.cancelledHere.map((entry) => entry.raw)).toEqual([
      'Exp Writing (CY-B) 11:20-01:05 Cancelled',
    ]);
  });

  /**
   * `Tutorial`, `SDA Lab`, `FSM` -- cells naming no section and no time we can
   * pin down. Something is happening in those rooms. Counting them as empty is
   * the one answer this feature must never give.
   */
  it('will not call a room free when it cannot read what is in it', () => {
    const statuses = roomAvailability(monday, span(9, 0, 9, 50));
    const unknown = statuses.filter((status) => status.availability === 'UNKNOWN');

    expect(unknown.length).toBeGreaterThan(0);
    for (const status of unknown) {
      expect(status.conflicting.length).toBeGreaterThan(0);
      expect(freeRooms(monday, span(9, 0, 9, 50)).map((s) => s.room)).not.toContain(status.room);
    }
  });

  it.each(DAYS)('%s empties out by the evening', (file, weekday) => {
    const day = dayFor(file, weekday);
    const midday = freeRooms(day, span(11, 0, 11, 50)).length;
    const evening = freeRooms(day, span(19, 0, 19, 50)).length;

    expect(evening).toBeGreaterThan(midday);
  });
});

describe('how long a free room stays free', () => {
  it('reports the next class as the moment it becomes busy', () => {
    const window = span(9, 0, 9, 50);
    for (const status of freeRooms(monday, window)) {
      const nextStart = roomSchedule(monday, status.room)
        .filter((entry) => entry.status !== 'CANCELLED' && entry.time !== null)
        .map((entry) => entry.time?.startMinute ?? 0)
        .filter((start) => start >= window.endMinute)
        .sort((a, b) => a - b)[0];

      expect(status.busyFromMinute).toBe(nextStart ?? null);
    }
  });

  it('offers the longest-free rooms first', () => {
    const listed = freeRooms(monday, span(13, 0, 13, 50)).map(
      (status) => status.busyFromMinute ?? Number.POSITIVE_INFINITY,
    );
    const descending = [...listed].sort((a, b) => b - a);

    expect(listed).toEqual(descending);
  });
});

describe('turning "now" into a place in the timetable', () => {
  // 06:05 UTC is 11:05 in Islamabad, which is UTC+5 and keeps no daylight saving.
  const wednesdayMorning = new Date('2026-09-09T06:05:00Z');

  it('reads the campus weekday and hour, not the viewer\'s', () => {
    const moment = toTimetableMoment(wednesdayMorning);

    expect(moment.weekday).toBe('WEDNESDAY');
    expect(moment.minuteOfDay).toBe(at(11, 5));
    expect(moment.timeZone).toBe(CAMPUS_TIME_ZONE);
  });

  /**
   * The same instant read elsewhere is a different hour, which is exactly why
   * the zone is explicit. The spreadsheet's own `America/Los_Angeles` is an
   * unchanged default and would put the campus half a day out.
   */
  it('gives a different answer in a different zone, and says which it used', () => {
    const elsewhere = toTimetableMoment(wednesdayMorning, 'America/Los_Angeles');

    expect(elsewhere.minuteOfDay).not.toBe(at(11, 5));
    expect(elsewhere.timeZone).toBe('America/Los_Angeles');
  });

  it('has no weekday at the weekend, because the timetable has no Saturday', () => {
    expect(toTimetableMoment(new Date('2026-09-12T07:00:00Z')).weekday).toBeNull();
    expect(toTimetableMoment(new Date('2026-09-13T07:00:00Z')).weekday).toBeNull();
  });

  it('handles midnight, which some runtimes render as hour 24', () => {
    // 19:00 UTC is midnight in Islamabad.
    expect(toTimetableMoment(new Date('2026-09-08T19:00:00Z')).minuteOfDay).toBe(0);
  });

  /**
   * A room empty this second but taken in four minutes is not somewhere to go,
   * so the question asked is always about a span rather than an instant.
   */
  it('asks about the next half hour by default', () => {
    expect(windowFrom(at(11, 5))).toEqual({ startMinute: at(11, 5), endMinute: at(11, 35) });
    expect(windowFrom(at(11, 5), 90)).toEqual({ startMinute: at(11, 5), endMinute: at(12, 35) });
    // A zero-length window would make every room trivially free.
    expect(windowFrom(at(11, 5), 0).endMinute).toBeGreaterThan(at(11, 5));
  });

  it('answers the question end to end', () => {
    const moment = toTimetableMoment(wednesdayMorning);
    expect(moment.weekday).toBe('WEDNESDAY');

    const day = dayFor('wednesday', 'WEDNESDAY');
    const free = freeRooms(day, windowFrom(moment.minuteOfDay, 30));

    expect(free.length).toBeGreaterThan(0);
    expect(free.length).toBeLessThan(day.rooms.length);
    for (const status of free) expect(day.rooms).toContain(status.room);
  });
});
