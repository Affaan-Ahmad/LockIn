import { Caption } from '@/components/paper';
import {
  USER_EVENT_KIND_LABEL,
  type UserEvent,
} from '@/domain/student-content/types';
import { formatClock, type TimeFormat } from '@/lib/clock';

import { EventDeleteButton } from './EventDeleteButton';

/**
 * The student's own entries, as cards beside the published deadlines.
 *
 * A section of their own rather than rows mixed into the deadline groups. Those
 * groups are built from coursework Google published and carry a submission
 * state, a classification and an override history; an event a student typed in
 * has none of those, and flattening it into the same list would mean either
 * inventing those fields or making every row check whether it has them.
 *
 * Keeping them adjacent rather than merged also keeps the distinction visible,
 * which matters: one of these is authoritative and the other is a reminder
 * somebody set themselves.
 */

export interface EventListProps {
  readonly events: readonly UserEvent[];
  readonly timeZone: string;
  readonly timeFormat: TimeFormat;
  /** Set when the calendar is filtering to one day, for the empty wording. */
  readonly filtered: boolean;
}

export function EventList({ events, timeZone, timeFormat, filtered }: EventListProps) {
  if (events.length === 0) {
    // Nothing at all is not worth a section. The "Add your own" control lives in
    // the header beside it, so there is still a way in.
    return null;
  }

  return (
    <section aria-labelledby="your-events-heading" className="mb-7">
      <div className="flex items-center gap-3">
        <Caption>
          <span id="your-events-heading">Yours</span>
        </Caption>
        <span aria-hidden="true" className="h-px flex-1 bg-edge-soft" />
        <span className="font-mono text-[11.5px] text-ink-faint tabular-nums">{events.length}</span>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {events.map((event) => (
          <li
            key={event.id}
            className="relative overflow-hidden rounded-sm bg-p3 py-3 pr-3 pl-5 shadow-lift-1"
          >
            {/* Slate, the same hue the calendar dot uses, so the two read as the
                same kind of thing in two places. */}
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px] bg-slate" />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                    {event.title}
                  </span>
                  <span className="rounded-xs bg-p1 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft shadow-lift-0">
                    {USER_EVENT_KIND_LABEL[event.kind]}
                  </span>
                </span>
                {event.note === null ? null : (
                  <span className="mt-0.5 block text-[12px] text-ink-soft">{event.note}</span>
                )}
              </span>

              <span className="shrink-0 text-right">
                <span className="block font-mono text-[12.5px] text-ink tabular-nums">
                  {dayLabel(event.startsAt, timeZone)}
                </span>
                <span className="block font-mono text-[11.5px] text-ink-faint tabular-nums">
                  {formatClock(minuteOfDay(event.startsAt, timeZone), timeFormat)}
                </span>
              </span>

              <EventDeleteButton eventId={event.id} title={event.title} />
            </div>
          </li>
        ))}
      </ul>

      {filtered ? null : (
        <p className="mt-2 px-0.5 text-[11.5px] text-ink-faint">
          These are only yours. Nothing here is read from Classroom, and nothing here is sent to it.
        </p>
      )}
    </section>
  );
}

/** `Fri 12 Sept`, in the student's zone rather than the server's. */
function dayLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/**
 * Minutes past midnight in the student's zone.
 *
 * Goes through `formatClock` rather than `Intl` directly so a student who chose
 * a twelve-hour clock sees one here too. Times in two formats on one screen is
 * the bug the clock preference exists to prevent.
 */
function minuteOfDay(date: Date, timeZone: string): number {
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type as string, part.value]),
  );
  return Number(parts.get('hour') ?? '0') * 60 + Number(parts.get('minute') ?? '0');
}
