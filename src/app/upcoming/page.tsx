import Link from 'next/link';

import { CheckIcon } from '@/components/icons';
import { Shell } from '@/components/shell/Shell';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { DeadlineGroups } from '@/features/dashboard/DeadlineGroups';
import { EventForm } from '@/features/dashboard/EventForm';
import { EventList } from '@/features/dashboard/EventList';
import { MonthCalendar } from '@/features/dashboard/MonthCalendar';
import { OfflineMirror } from '@/features/offline/OfflineMirror';
import { AutoSync } from '@/features/sync/AutoSync';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { deadlineDayKey } from '@/lib/format';
import { readTimeFormat } from '@/lib/preferences';
import { loadDashboard, loadUserEvents, requireSessionUser } from '@/lib/queries';

/**
 * Everything ahead, in order, and on a calendar.
 *
 * Today answers "what now?"; this answers "what is coming?". The difference is
 * scope, not data, so it reuses the same loader and the same grouping rather
 * than growing a second definition of what counts as upcoming.
 *
 * The calendar answers a third question a list is bad at: how the term is
 * shaped. A list makes "three things on Friday" invisible until you count them;
 * a month makes it obvious. Selecting a day filters the list beneath rather
 * than opening anything, so the two views stay one screen.
 *
 * Both the month and the selected day live in the URL, which keeps this a
 * Server Component and makes a filtered view shareable.
 *
 * Overdue work is not repeated in the list -- it is on Today, and showing it
 * twice would make a page of future work read as a backlog -- but it does
 * appear on the calendar, because a month with a missed deadline hidden from it
 * is a misleading picture of the month.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function UpcomingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const now = new Date();
  // From the start of today, not from `now`: a quiz at 9am is still today's
  // problem at 10am, and dropping it the moment it starts is how a student
  // loses the thing they are walking to.
  const [data, params, events, timeFormat] = await Promise.all([
    loadDashboard(user.id),
    searchParams,
    loadUserEvents(user.id, startOfDay(now)),
    readTimeFormat(),
  ]);
  const { timeZone } = data.freshness;

  const selectedDay = typeof params['day'] === 'string' ? params['day'] : null;
  // A malformed month falls back to the current one rather than rendering an
  // empty grid for the year 0.
  const month =
    typeof params['month'] === 'string' && /^\d{4}-\d{2}$/.test(params['month'])
      ? params['month']
      : monthOf(now, timeZone);

  const calendarItems = [...data.overdue, ...data.upcoming];

  const listed =
    selectedDay === null
      ? [...data.upcoming, ...data.undated]
      : calendarItems.filter((item) => deadlineDayKey(item.deadline, timeZone) === selectedDay);

  // The student's own entries follow the same day filter as the deadlines, so
  // selecting a date on the calendar narrows both halves of the screen rather
  // than only one.
  const listedEvents =
    selectedDay === null
      ? events
      : events.filter((event) => localDayKey(event.startsAt, timeZone) === selectedDay);

  function hrefFor({ month: m, day }: { month?: string; day?: string | null }): string {
    const next = new URLSearchParams();
    if (m !== undefined) next.set('month', m);
    if (day !== undefined && day !== null) next.set('day', day);
    const query = next.toString();
    return query === '' ? '/upcoming' : `/upcoming?${query}`;
  }

  return (
    <Shell
      title="Upcoming"
      subtitle={
        data.upcoming.length === 0
          ? undefined
          : `${String(data.upcoming.length)} ${data.upcoming.length === 1 ? 'deadline' : 'deadlines'} ahead.`
      }
      reviewCount={data.reviewCount}
      headerAside={<SyncStatus freshness={data.freshness} />}
      rail={
        <MonthCalendar
          items={calendarItems}
          events={events}
          now={now}
          timeZone={timeZone}
          month={month}
          selectedDay={selectedDay}
          hrefFor={hrefFor}
        />
      }
    >
      <SyncStatus freshness={data.freshness} variant="banner" />
      <AutoSync level={data.freshness.level} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold tracking-[-0.02em] text-ink">Plan what comes next</h2>
        <div className="flex flex-wrap items-center gap-3">
          <a href="#deadline-calendar" className="button-link text-kraft-3 xl:hidden">
            Browse dates
          </a>
          <EventForm />
        </div>
      </div>

      {/* The offline copy of this screen. Written from what has already been
          rendered, so it costs no request and cannot disagree with the page. */}
      <OfflineMirror
        userId={user.id}
        timeZone={timeZone}
        section="upcoming"
        value={{
          savedAt: Date.now(),
          items: [...data.upcoming, ...data.undated].map((item) => ({
            assignmentId: item.assignmentId,
            courseName: item.courseName,
            title: item.title,
            dueAtUtc: item.deadline.dueAtUtc ?? null,
            dueDateUtc: item.deadline.dueDateUtc ?? null,
            submissionState: item.submissionState,
          })),
          events: events.map((event) => ({
            id: event.id,
            title: event.title,
            kind: event.kind,
            startsAt: event.startsAt.toISOString(),
            note: event.note,
          })),
        }}
      />

      <EventList
        events={listedEvents}
        timeZone={timeZone}
        timeFormat={timeFormat}
        filtered={selectedDay !== null}
      />

      {listed.length === 0 && listedEvents.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title={selectedDay === null ? 'Nothing due ahead' : 'Nothing due that day'}
          body={
            selectedDay !== null
              ? 'Pick another date, or show every date.'
              : data.overdue.length > 0
                ? 'No future deadlines. You do have overdue work on Today.'
                : 'No future deadlines in your tracked courses. New coursework appears here after a sync.'
          }
          action={
            selectedDay !== null ? (
              <ButtonLink href="/upcoming" variant="secondary">Show every date</ButtonLink>
            ) : (
              <Link href={data.overdue.length > 0 ? '/' : '/courses'}>
                <Button variant="secondary">
                  {data.overdue.length > 0 ? 'Go to Today' : 'Manage courses'}
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <DeadlineGroups items={listed} now={now} timeZone={timeZone} />
      )}
    </Shell>
  );
}

/** The month `now` falls in, in the student's zone rather than the server's. */
function monthOf(now: Date, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit' })
      .formatToParts(now)
      .map((part) => [part.type as string, part.value]),
  );
  return `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}`;
}

/** Midnight today, in the student's own zone rather than the server's. */
function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** `YYYY-MM-DD` for an instant, in the given zone. Matches deadlineDayKey. */
function localDayKey(date: Date, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type as string, part.value]),
  );
  return `${parts.get('year') ?? '0000'}-${parts.get('month') ?? '00'}-${parts.get('day') ?? '00'}`;
}
