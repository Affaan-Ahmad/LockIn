import { CalendarIcon, ClockIcon } from '@/components/icons';
import { PaperRailHeading, PaperTab } from '@/components/paper';
import { Shell } from '@/components/shell/Shell';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CAMPUS_TIME_ZONE, WHOLE_COHORT_SECTION, type Weekday } from '@/domain/timetable';
import { ClassList } from '@/features/timetable/ClassList';
import { CohortPicker } from '@/features/timetable/CohortPicker';
import { FreeRoomsPanel } from '@/features/timetable/FreeRoomsPanel';
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

const DAYS: readonly Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];
const SHORT: Readonly<Record<Weekday, string>> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
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
    <Shell
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
            <PaperRailHeading>Your cohort</PaperRailHeading>
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
            <PaperRailHeading>Find a free room</PaperRailHeading>
            {screen.configured && screen.error === null ? (
              <FreeRoomsPanel timeFormat={screen.timeFormat} />
            ) : (
              <p className="text-xs text-ink-muted">Unavailable until the timetable can be read.</p>
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label="Timetable source">
            <PaperRailHeading>Source</PaperRailHeading>
            <p className="text-xs text-ink-muted">
              {screen.documentTitle ?? 'The university timetable'}
              {screen.fetchedAt === null ? null : (
                <>
                  {' · read '}
                  <time dateTime={screen.fetchedAt.toISOString()}>
                    {screen.fetchedAt.toLocaleTimeString('en-GB', {
                      hour: screen.timeFormat === '12' ? 'numeric' : '2-digit',
                      minute: '2-digit',
                      hour12: screen.timeFormat === '12',
                      timeZone: CAMPUS_TIME_ZONE,
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
            <p className="text-[13.5px] font-semibold text-ink">{day.dayLabel}</p>
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
            <ClassList matches={matches} timeFormat={screen.timeFormat} />
          )}
        </div>
      )}
    </Shell>
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
    // Cut tabs, not filled chips. The selected day is a sheet of cardstock
    // lifted clear of the row with a strip of glow along its bottom edge, so it
    // reads as joined to the classes below it rather than as a pressed button.
    <nav aria-label="Day" className="flex flex-wrap items-end gap-1">
      {DAYS.map((weekday) => (
        <PaperTab
          key={weekday}
          href={`/timetable?day=${weekday}`}
          active={weekday === selected}
        >
          {SHORT[weekday]}
          {weekday === today ? (
            <span className="ml-1.5 font-mono text-[10px] text-ink-faint">today</span>
          ) : null}
        </PaperTab>
      ))}
    </nav>
  );
}
