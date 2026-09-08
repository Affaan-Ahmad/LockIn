import type { NextResponse } from 'next/server';

import { formatMinuteOfDay } from '@/domain/timetable';
import { loadFreeRooms } from '@/lib/timetable';

import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Which rooms are empty right now.
 *
 * A route rather than server-rendered data because the answer changes with the
 * clock: a student presses the button at 11:04 and again at 11:36 and must get
 * two different answers, without the page being rebuilt around them.
 *
 * "Now" is decided here, on the server, from the campus time zone. Trusting a
 * time sent by the browser would let a device with a wrong clock -- or a
 * traveller's laptop still on another continent -- ask about the wrong hour and
 * be told, confidently, that a room in use is free.
 *
 * This costs nothing at Google: the timetable is cached for the whole server,
 * so pressing the button reads memory.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bounds on "for how long", so a caller cannot ask about a whole week. */
const MIN_MINUTES = 5;
const MAX_MINUTES = 240;
const DEFAULT_MINUTES = 30;

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    await requireUser();

    const requested = Number(new URL(request.url).searchParams.get('forMinutes'));
    const forMinutes = Number.isFinite(requested)
      ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(requested)))
      : DEFAULT_MINUTES;

    const result = await loadFreeRooms(new Date(), forMinutes);

    return jsonOk({
      weekday: result.weekday,
      at: formatMinuteOfDay(result.minuteOfDay),
      forMinutes: result.forMinutes,
      // Counted rather than listed: a student wants somewhere to sit, not a
      // census of the building. The unknown count is still reported, because
      // "we could not account for six rooms" is part of an honest answer.
      occupiedCount: result.occupiedCount,
      unknownCount: result.unknownCount,
      rooms: result.rooms.map((status) => ({
        room: status.room,
        freeUntil: status.busyFromMinute === null ? null : formatMinuteOfDay(status.busyFromMinute),
        cancelledHere: status.cancelledHere.map((entry) => entry.raw),
      })),
    });
  });
}
