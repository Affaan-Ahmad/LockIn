import { describe, expect, it } from 'vitest';

import { cohortOptions, freeRooms, windowFrom } from '@/domain/timetable';
import {
  loadTimetable,
  resetTimetableCacheForTests,
} from '@/infrastructure/google/timetable.client';

/**
 * The credentialed path, end to end, against the real document.
 *
 * Skipped when the timetable credential is absent, so a clean checkout still
 * runs green. When it is present this is the only test that proves the parts
 * nothing else can: that the stored refresh token still works, that Google
 * still answers the field mask we send, and that what comes back parses into a
 * week rather than into nothing.
 *
 * Read-only. It touches no database and writes nothing anywhere -- unlike the
 * persistence suite beside it, which is why this one is safe to run on its own.
 */

/**
 * Read straight from the environment rather than through the validated config.
 * The validated config checks every required variable at once, so asking it
 * whether the timetable is set up would throw on a checkout that simply has no
 * `.env.local` -- turning a skip into a failure.
 */
const configured =
  (process.env['TIMETABLE_REFRESH_TOKEN'] ?? '') !== '' &&
  (process.env['TIMETABLE_SPREADSHEET_ID'] ?? '') !== '';
const suite = configured ? describe : describe.skip;

if (!configured) {
  console.warn('Timetable credential absent; skipping the live timetable checks.');
}

suite('the published timetable, live', () => {
  it('reads the whole standing week with the stored credential', async () => {
    resetTimetableCacheForTests();
    const snapshot = await loadTimetable();

    expect(snapshot.stale).toBe(false);
    expect(snapshot.documentTitle).not.toBe('');
    // Monday to Friday. Fewer means a tab stopped being recognised; more means
    // a hidden dated sitting leaked into the standing week.
    expect(snapshot.days).toHaveLength(5);

    for (const day of snapshot.days) {
      expect(day.entries.length).toBeGreaterThan(100);
      expect(day.rooms.length).toBeGreaterThan(40);
      expect(day.legend.size).toBeGreaterThanOrEqual(20);
      // The invariant the whole parser exists for: a class is attributed to an
      // intake, and the only thing carrying that is the cell's colour.
      expect(day.entries.some((entry) => entry.cohort !== null)).toBe(true);
    }
  }, 60_000);

  it('serves the second read from cache rather than fetching again', async () => {
    const first = await loadTimetable();
    const second = await loadTimetable();

    // Same object identity: no second round trip to Google for a document every
    // student on the deployment is looking at.
    expect(second).toBe(first);
  }, 60_000);

  it('offers cohorts a student can actually pick', async () => {
    const snapshot = await loadTimetable();
    const options = cohortOptions(snapshot.days);

    expect(options.length).toBeGreaterThan(10);
    expect(options.map((option) => option.label)).not.toContain('Repeat Courses');
    for (const option of options) {
      expect(option.label).not.toBe('');
      expect(['UNDERGRADUATE', 'POSTGRADUATE']).toContain(option.kind);
    }
  }, 60_000);

  it('answers which rooms are free, without inventing any', async () => {
    const snapshot = await loadTimetable();
    const monday = snapshot.days.find((day) => day.weekday === 'MONDAY');
    if (monday === undefined) throw new Error('no Monday in the live document');

    const midMorning = freeRooms(monday, windowFrom(11 * 60, 30));
    const evening = freeRooms(monday, windowFrom(19 * 60, 30));

    // Every answer names a room the document itself lists.
    for (const status of [...midMorning, ...evening]) {
      expect(monday.rooms).toContain(status.room);
    }
    // A teaching day is busier at eleven than at seven in the evening. If this
    // ever fails, times are being read wrongly.
    expect(evening.length).toBeGreaterThan(midMorning.length);
  }, 60_000);
});
