import Link from 'next/link';

import { CalendarIcon, ClockIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { WHOLE_COHORT_SECTION, type Weekday } from '@/domain/timetable';
import { ClassList } from '@/features/timetable/ClassList';
import { CohortPicker } from '@/features/timetable/CohortPicker';
import { FreeRoomsPanel } from '@/features/timetable/FreeRoomsPanel';
import { cx } from '@/lib/cx';
import { loadReviewCount, requireSessionUser } from '@/lib/queries';
import { classesFor, loadTimetableScreen } from '@/lib/timetable';

/**
 * The published class timetable.
 *
 * Read from the university's own document rather than entered by hand, so it
 * follows a rescheduled class without anyone re-typing it. It is deliberately
 * separate from the deadline screens: coursework is personal and comes from
 * Classroom, while this is one document the whole university shares.
 *
 * Never cached. A timetable is edited during the semester -- that is the reason
 * to sync it at all -- and a cached page would show a class in a room it was
 * moved out of.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const DAYS: readonly Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const SHORT: Readonly<Record<Weekday, string>> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
};

const isWeekday = (value: string | undefined): value is Weekday =>
  value !== undefined && (DAYS as readonly string[]).includes(value);

export default async function TimetablePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const [params, screen, reviewCount] = await Promise.all([
    searchParams,
    loadTimetableScreen(),
    loadReviewCount(user.id),
  ]);

  const requested = typeof params['day'] === 'string' ? params['day'].toUpperCase() : undefined;
  // Today by default, and Monday at the weekend rather than an empty screen.
  const selectedDay: Weekday = isWeekday(requested)
    ? requested
    : (screen.todayWeekday ?? 'MONDAY');

  const day = screen.days.find((candidate) => candidate.weekday === selectedDay) ?? null;
  const matches = screen.selection === null ? [] : classesFor(screen, selectedDay, screen.selection);

  return (
    <AppShell
      title="Timetable"
      subtitle={
        screen.selection === null
          ? undefined
          : screen.selection.section === WHOLE_COHORT_SECTION
            ? screen.selection.cohortLabel
            : `${screen.selection.cohortLabel} · Section ${screen.selection.section}`
      }
      reviewCount={reviewCount}
      rail={
        <>
          <section className="flex flex-col gap-3" aria-label="Your cohort">
            <h2 className="context-heading">Your cohort</h2>
            {screen.configured && screen.error === null ? (
              <CohortPicker options={screen.options} selected={screen.selection} />
            ) : (
              <p className="text-xs text-ink-muted">Unavailable until the timetable can be read.</p>
            )}
            <p className="text-xs text-ink-muted">
              This only changes what this screen shows. It does not affect which coursework LockIn
              treats as yours.
            </p>
          </section>

          <section className="flex flex-col gap-3" aria-label="Free rooms">
            <h2 className="context-heading">Find a free room</h2>
            {screen.configured && screen.error === null ? (
              <FreeRoomsPanel />
            ) : (
              <p className="text-xs text-ink-muted">Unavailable until the timetable can be read.</p>
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label="Timetable source">
            <h2 className="context-heading">Source</h2>
            <p className="text-xs text-ink-muted">
              {screen.documentTitle ?? 'The university timetable'}
              {screen.fetchedAt === null ? null : (
                <>
                  {' · read '}
                  <time dateTime={screen.fetchedAt.toISOString()}>
                    {screen.fetchedAt.toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Karachi',
                    })}
                  </time>
                </>
              )}
            </p>
            {screen.stale ? (
              <p className="text-xs text-ink-soft">
                The document could not be re-read just now, so this is the last copy LockIn
                retrieved. Check the sheet itself before relying on it.
              </p>
            ) : null}
          </section>
        </>
      }
    >
      {!screen.configured ? (
        <EmptyState
          icon={<CalendarIcon className="size-6" />}
          title="The timetable is not set up"
          body="This deployment has no credential for the university's timetable document, so there is nothing to show yet."
          action={<ButtonLink href="/" variant="secondary">Back to Today</ButtonLink>}
        />
      ) : screen.error !== null ? (
        <EmptyState
          icon={<ClockIcon className="size-6" />}
          title="The timetable could not be read"
          body={screen.error}
          action={<ButtonLink href="/timetable" variant="secondary">Try again</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <DayTabs selected={selectedDay} today={screen.todayWeekday} />

          {day?.dayLabel !== undefined && day.dayLabel.toLowerCase() !== selectedDay.toLowerCase() ? (
            // The sheet uses the day heading to say things that change where a
            // student has to be -- "Friday ONLINE" -- so it is shown, not tidied.
            <p className="text-sm font-medium text-ink">{day.dayLabel}</p>
          ) : null}

          {screen.selection === null ? (
            <EmptyState
              icon={<CalendarIcon className="size-6" />}
              title="Tell LockIn which section you are in"
              body="The timetable lists every programme in the university. Choose your programme, intake and section to see only your own classes."
            />
          ) : matches.length === 0 ? (
            <EmptyState
              icon={<CalendarIcon className="size-6" />}
              title="No classes listed"
              body={`The published timetable has nothing for ${screen.selection.cohortLabel}${
                screen.selection.section === WHOLE_COHORT_SECTION
                  ? ''
                  : ` section ${screen.selection.section}`
              } on this day.`}
            />
          ) : (
            <ClassList matches={matches} />
          )}
        </div>
      )}
    </AppShell>
  );
}

function DayTabs({
  selected,
  today,
}: {
  readonly selected: Weekday;
  readonly today: Weekday | null;
}) {
  return (
    <nav aria-label="Day" className="flex flex-wrap gap-1.5">
      {DAYS.map((weekday) => {
        const active = weekday === selected;
        return (
          <Link
            key={weekday}
            href={`/timetable?day=${weekday}`}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'min-h-9 rounded-control px-3 py-1.5 text-sm transition-colors duration-[120ms]',
              active
                ? 'bg-brand-soft font-semibold text-brand-ink'
                : 'font-medium text-ink-soft hover:bg-sunken hover:text-ink',
            )}
          >
            {SHORT[weekday]}
            {weekday === today ? (
              <span className="ml-1.5 text-2xs font-normal text-ink-muted">today</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
