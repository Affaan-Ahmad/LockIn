import Link from 'next/link';

import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { DeadlineGroups } from '@/features/dashboard/DeadlineGroups';
import { MonthCalendar } from '@/features/dashboard/MonthCalendar';
import { AutoSync } from '@/features/sync/AutoSync';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { deadlineDayKey } from '@/lib/format';
import { loadDashboard, requireSessionUser } from '@/lib/queries';

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

export default async function UpcomingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const [data, params] = await Promise.all([loadDashboard(user.id), searchParams]);
  const now = new Date();
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
      ? data.upcoming
      : calendarItems.filter((item) => deadlineDayKey(item.deadline, timeZone) === selectedDay);

  function hrefFor({ month: m, day }: { month?: string; day?: string | null }): string {
    const next = new URLSearchParams();
    if (m !== undefined) next.set('month', m);
    if (day !== undefined && day !== null) next.set('day', day);
    const query = next.toString();
    return query === '' ? '/upcoming' : `/upcoming?${query}`;
  }

  return (
    <AppShell
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

      {listed.length === 0 ? (
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
              <Link href="/upcoming">
                <Button variant="secondary">Show every date</Button>
              </Link>
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
    </AppShell>
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
