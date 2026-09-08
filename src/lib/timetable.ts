import 'server-only';

import { cookies } from 'next/headers';

import {
  cohortOptions,
  findCohort,
  freeRooms,
  roomAvailability,
  selectForStudent,
  toTimetableMoment,
  windowFrom,
  byStartTime,
  type CohortOption,
  type RoomStatus,
  type TimetableDay,
  type TimetableMatch,
  type Weekday,
  WHOLE_COHORT_SECTION,
} from '@/domain/timetable';
import {
  isTimetableConfigured,
  loadTimetable,
  type TimetableSnapshot,
} from '@/infrastructure/google/timetable.client';

/**
 * Server-side reads for the timetable screens.
 *
 * Sits alongside `queries.ts` and follows the same rule: pages call these,
 * pages do not call infrastructure. The difference is that none of this is
 * per-user data -- the timetable is one document for the whole university, so
 * there is nothing here to scope to a session.
 *
 * The student's own cohort is held in a cookie rather than the database. It is
 * a view preference, not a fact the system reasons about: choosing wrongly
 * shows the wrong week and is corrected in one click, whereas a wrong section
 * on the Classroom side silently hides real coursework. Persisting it per
 * account is a single nullable column when it is wanted.
 */

export const COHORT_COOKIE = 'lockin_timetable_cohort';
export const SECTION_COOKIE = 'lockin_timetable_section';

export interface TimetableSelection {
  readonly cohortLabel: string;
  readonly section: string;
}

export interface TimetableScreen {
  readonly configured: boolean;
  /** Set when the document could not be read at all. */
  readonly error: string | null;
  readonly days: readonly TimetableDay[];
  readonly options: readonly CohortOption[];
  readonly selection: TimetableSelection | null;
  readonly fetchedAt: Date | null;
  readonly stale: boolean;
  readonly documentTitle: string | null;
  /** The campus weekday now, or null at the weekend. */
  readonly todayWeekday: Weekday | null;
  readonly nowMinute: number;
}

const emptyScreen = (error: string | null): TimetableScreen => {
  const moment = toTimetableMoment(new Date());
  return {
    configured: isTimetableConfigured(),
    error,
    days: [],
    options: [],
    selection: null,
    fetchedAt: null,
    stale: false,
    documentTitle: null,
    todayWeekday: moment.weekday,
    nowMinute: moment.minuteOfDay,
  };
};

async function readSelection(options: readonly CohortOption[]): Promise<TimetableSelection | null> {
  const jar = await cookies();
  const label = jar.get(COHORT_COOKIE)?.value ?? null;
  const section = jar.get(SECTION_COOKIE)?.value ?? null;

  const cohort = findCohort(options, label);
  if (cohort === null || section === null) return null;

  // A cohort taught as one group has no section to store.
  if (cohort.sections.length === 0) {
    return section === WHOLE_COHORT_SECTION
      ? { cohortLabel: cohort.label, section }
      : null;
  }
  // A section that has vanished from the sheet -- a cohort graduating, a
  // section merged -- must not silently select nothing.
  if (!cohort.sections.includes(section)) return null;

  return { cohortLabel: cohort.label, section };
}

/** Everything the timetable screen renders from. Never throws. */
export async function loadTimetableScreen(): Promise<TimetableScreen> {
  if (!isTimetableConfigured()) return emptyScreen(null);

  let snapshot: TimetableSnapshot;
  try {
    snapshot = await loadTimetable();
  } catch (error) {
    // The screen explains itself rather than falling over: an unreadable
    // timetable is a thing to report, not a reason to break navigation.
    return emptyScreen(error instanceof Error ? error.message : 'The timetable could not be read.');
  }

  const options = cohortOptions(snapshot.days);
  const moment = toTimetableMoment(new Date());

  return {
    configured: true,
    error: null,
    days: snapshot.days,
    options,
    selection: await readSelection(options),
    fetchedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
    documentTitle: snapshot.documentTitle,
    todayWeekday: moment.weekday,
    nowMinute: moment.minuteOfDay,
  };
}

/** One day's classes for a chosen cohort and section, in order. */
export function classesFor(
  screen: TimetableScreen,
  weekday: Weekday,
  selection: TimetableSelection,
): readonly TimetableMatch[] {
  const day = screen.days.find((candidate) => candidate.weekday === weekday);
  if (day === undefined) return [];

  const cohort = findCohort(screen.options, selection.cohortLabel);
  if (cohort === null) return [];

  return [
    ...selectForStudent(day.entries, {
      cohortLabel: cohort.label,
      programCode: cohort.programCode ?? '',
      intakeYear: cohort.intakeYear,
      section: selection.section,
    }),
  ].sort(byStartTime);
}

export interface FreeRoomsResult {
  readonly weekday: Weekday | null;
  readonly minuteOfDay: number;
  readonly forMinutes: number;
  readonly rooms: readonly RoomStatus[];
  readonly unknownCount: number;
  readonly occupiedCount: number;
}

/**
 * Which rooms are empty at a moment.
 *
 * Needs no cohort and no student: it is the same answer for everybody, which is
 * why it is the one part of this feature that works before anyone has told us
 * who they are.
 */
export async function loadFreeRooms(
  at: Date = new Date(),
  forMinutes = 30,
): Promise<FreeRoomsResult> {
  const moment = toTimetableMoment(at);
  const empty: FreeRoomsResult = {
    weekday: moment.weekday,
    minuteOfDay: moment.minuteOfDay,
    forMinutes,
    rooms: [],
    unknownCount: 0,
    occupiedCount: 0,
  };

  if (moment.weekday === null || !isTimetableConfigured()) return empty;

  const snapshot = await loadTimetable();
  const day = snapshot.days.find((candidate) => candidate.weekday === moment.weekday);
  if (day === undefined) return empty;

  const window = windowFrom(moment.minuteOfDay, forMinutes);
  const all = roomAvailability(day, window);

  return {
    ...empty,
    rooms: freeRooms(day, window),
    // Reported alongside the free rooms so the screen can be honest about how
    // much of the building it could not account for.
    unknownCount: all.filter((status) => status.availability === 'UNKNOWN').length,
    occupiedCount: all.filter((status) => status.availability === 'OCCUPIED').length,
  };
}
