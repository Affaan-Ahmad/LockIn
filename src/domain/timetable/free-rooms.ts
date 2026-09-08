import type { MinuteOfDay, TimeRange, TimetableDay, TimetableEntry } from './types';

/**
 * Which rooms are empty, and when.
 *
 * The timetable says where every class is; the useful inverse is where no class
 * is. That inverse is only trustworthy if two things hold, and both are easy to
 * get wrong.
 *
 * **The room list comes from the sheet, not from the classes.** A room with
 * nothing booked in it all day produces no entries at all, so deriving the list
 * from entries would hide exactly the rooms worth reporting. `TimetableDay.rooms`
 * is read from the sheet's own room columns for this reason.
 *
 * **"I don't know" is not "free".** Sending somebody to a room that turns out to
 * have a class in it is worse than not answering, so a room holding a class we
 * could not fully read is reported UNKNOWN rather than quietly counted as empty.
 * That is the same three-valued caution the rest of this codebase applies to
 * coursework.
 */

export type RoomAvailability =
  /** Nothing the sheet knows about is in this room for the whole window. */
  | 'FREE'
  /** A class is running here for at least part of the window. */
  | 'OCCUPIED'
  /**
   * Something is in this room that we could not place or fully read. It may
   * well be empty; we cannot say so.
   */
  | 'UNKNOWN';

export interface RoomStatus {
  readonly room: string;
  readonly availability: RoomAvailability;
  /** What makes the room busy, or what makes it uncertain. */
  readonly conflicting: readonly TimetableEntry[];
  /**
   * Classes cancelled in this room during the window. The room counts as free,
   * but a student deserves to know why it is empty -- and that whoever cancelled
   * it may not have told everyone.
   */
  readonly cancelledHere: readonly TimetableEntry[];
  /**
   * When the next class starts after the window, for a room that is free.
   * Null when nothing else is booked that day.
   */
  readonly busyFromMinute: MinuteOfDay | null;
}

/**
 * When a room stops being occupied by a class.
 *
 * An extension moves the end and nothing else, so a class written
 * `02:30-04:15 Extended till 05:15pm` holds its room until quarter past five.
 * Ignoring that would empty a room an hour early.
 */
export function occupiedUntil(entry: TimetableEntry): MinuteOfDay | null {
  if (entry.time === null) return null;
  return Math.max(entry.time.endMinute, entry.extendedUntilMinute ?? entry.time.endMinute);
}

const overlapsWindow = (entry: TimetableEntry, window: TimeRange): boolean => {
  const end = occupiedUntil(entry);
  if (entry.time === null || end === null) return false;
  return entry.time.startMinute < window.endMinute && window.startMinute < end;
};

/**
 * Every published room, with what is in it during `window`.
 *
 * A room is OCCUPIED if a class runs in it, UNKNOWN if the only thing we found
 * there could not be read or placed, and FREE otherwise. Occupied wins over
 * unknown: a definite class settles the question.
 */
export function roomAvailability(day: TimetableDay, window: TimeRange): readonly RoomStatus[] {
  const byRoom = new Map<string, TimetableEntry[]>();
  for (const entry of day.entries) {
    if (entry.room === '') continue;
    const existing = byRoom.get(entry.room);
    if (existing === undefined) byRoom.set(entry.room, [entry]);
    else existing.push(entry);
  }

  return day.rooms.map((room) => {
    const entries = byRoom.get(room) ?? [];

    const occupying: TimetableEntry[] = [];
    const uncertain: TimetableEntry[] = [];
    const cancelledHere: TimetableEntry[] = [];

    for (const entry of entries) {
      // A class we could not place is a class we cannot rule out of any window.
      if (entry.time === null) {
        uncertain.push(entry);
        continue;
      }
      if (!overlapsWindow(entry, window)) continue;

      if (entry.status === 'CANCELLED') cancelledHere.push(entry);
      else if (entry.status === 'UNCERTAIN') uncertain.push(entry);
      else occupying.push(entry);
    }

    const availability: RoomAvailability =
      occupying.length > 0 ? 'OCCUPIED' : uncertain.length > 0 ? 'UNKNOWN' : 'FREE';

    // For a room that is free, how long it stays that way.
    let busyFromMinute: MinuteOfDay | null = null;
    if (availability === 'FREE') {
      for (const entry of entries) {
        if (entry.time === null || entry.status === 'CANCELLED') continue;
        const start = entry.time.startMinute;
        if (start >= window.endMinute && (busyFromMinute === null || start < busyFromMinute)) {
          busyFromMinute = start;
        }
      }
    }

    return {
      room,
      availability,
      conflicting: [...occupying, ...uncertain],
      cancelledHere,
      busyFromMinute,
    };
  });
}

/**
 * Just the empty rooms, longest-free first.
 *
 * Ordering by how long a room stays free is the ordering somebody actually
 * wants: a room with four hours ahead of it beats one that is free for nine
 * minutes between classes. Rooms with nothing else booked all day come first.
 */
export function freeRooms(day: TimetableDay, window: TimeRange): readonly RoomStatus[] {
  return roomAvailability(day, window)
    .filter((status) => status.availability === 'FREE')
    .sort((a, b) => {
      const left = a.busyFromMinute ?? Number.POSITIVE_INFINITY;
      const right = b.busyFromMinute ?? Number.POSITIVE_INFINITY;
      if (left !== right) return right - left;
      return a.room.localeCompare(b.room);
    });
}

/** One room's day, in order. Timeless entries last, since they order nothing. */
export function roomSchedule(day: TimetableDay, room: string): readonly TimetableEntry[] {
  return day.entries
    .filter((entry) => entry.room === room)
    .sort(
      (a, b) =>
        (a.time?.startMinute ?? Number.POSITIVE_INFINITY) -
        (b.time?.startMinute ?? Number.POSITIVE_INFINITY),
    );
}
