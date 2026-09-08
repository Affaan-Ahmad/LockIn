import { PaperBadge } from '@/components/paper';
import type { TimetableMatch } from '@/domain/timetable';
import { formatClock, formatClockRange, toIsoTime, type TimeFormat } from '@/lib/clock';
import { cx } from '@/lib/cx';

/**
 * A day's classes.
 *
 * Time first, because that is what the list is ordered by and what a student
 * scans for. The room is given equal weight on the right: knowing a class is at
 * half eight is useless without knowing which building to walk to.
 *
 * Two things are shown that a tidier list would drop, and both are the point of
 * reading the timetable at all:
 *
 * - a **cancelled** class stays listed, struck through. Removing it would leave
 *   a student turning up, and telling them it is off is worth more than a
 *   clean list.
 * - a class we are **not certain** is theirs is marked rather than hidden. The
 *   sheet does not publish which laboratory subgroup anyone is in, so both are
 *   offered and labelled as possibilities.
 */

export interface ClassListProps {
  readonly matches: readonly TimetableMatch[];
  readonly timeFormat: TimeFormat;
}

export function ClassList({ matches, timeFormat }: ClassListProps) {
  return (
    // One sheet with banded rows. A day is read top to bottom in one go, so
    // giving each class its own card would put five shadows on a screen whose
    // whole job is a single continuous column of times.
    <ul className="divide-y divide-edge-soft overflow-hidden rounded-sm bg-p3 shadow-lift-2">
      {matches.map((match) => (
        <ClassRow
          key={`${match.entry.row}:${match.entry.column}:${match.entry.raw}`}
          match={match}
          timeFormat={timeFormat}
        />
      ))}
    </ul>
  );
}

function ClassRow({
  match,
  timeFormat,
}: {
  readonly match: TimetableMatch;
  readonly timeFormat: TimeFormat;
}) {
  const { entry } = match;
  const cancelled = entry.status === 'CANCELLED';
  const time = entry.time;

  return (
    <li
      className={cx(
        'relative flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 pr-4 pl-5 workbench:pl-4',
        cancelled && 'bg-p2',
      )}
    >
      {/* Cancelled is a cut edge as well as a strike-through. The line alone
          disappears at a glance down a column of six rows, and it is the one
          fact on this screen a student cannot afford to skim past. */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-y-0 left-0 w-[4px] workbench:hidden',
          cancelled ? 'bg-terra' : 'bg-edge-soft',
        )}
      />
      <span
        className={cx(
          'shrink-0 font-mono text-[13px] whitespace-nowrap tabular-nums',
          // A twelve-hour range is half again as wide as "08:30-09:50", and a
          // fixed column sized for the latter wrapped every row in two. The
          // column only exists once there is width for one: reserving 9.5rem of
          // a 390px row left the title too narrow to hold its own line.
          timeFormat === '12' ? 'sm:w-[9.5rem]' : 'sm:w-[7.5rem]',
          cancelled ? 'text-ink-faint' : 'text-ink-soft',
        )}
      >
        {time === null ? (
          <span title="The sheet publishes no time for this column">time not given</span>
        ) : (
          // The machine-readable value stays 24-hour whatever the student chose.
          <time dateTime={toIsoTime(time.startMinute)}>
            {formatClockRange(time.startMinute, time.endMinute, timeFormat)}
          </time>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cx(
            'text-[14px] font-semibold tracking-[-0.01em]',
            cancelled ? 'text-ink-faint line-through' : 'text-ink',
          )}
        >
          {entry.courseLabel}
        </span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-faint">
          {entry.sections.length > 0 ? <span>{entry.sections.map((s) => s.raw).join(', ')}</span> : null}
          {entry.extendedUntilMinute === null ? null : (
            <span>runs on to {formatClock(entry.extendedUntilMinute, timeFormat)}</span>
          )}
          {/* The sheet's own words, kept verbatim: a venue override, a one-off
              date, "ReSch". Paraphrasing them would lose the only note a
              student has to go on. */}
          {entry.notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </span>
      </span>

      {/* Its own row on a phone. Left beside a title that is already wrapping,
          the chip and the room have nowhere to go and end up drawn over it. */}
      <span className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
        {cancelled ? (
          <PaperBadge className="bg-terra text-on-fill">Cancelled</PaperBadge>
        ) : null}
        {match.confidence === 'POSSIBLE' ? (
          <PaperBadge
            title={
              match.reason === 'LAB_SUBGROUP'
                ? 'The sheet does not say which subgroup you are in, so both are shown.'
                : 'This is in your cohort, but the sheet does not name a section.'
            }
          >
            Check
          </PaperBadge>
        ) : null}
        <span
          className={cx(
            'font-mono text-[12.5px]',
            cancelled ? 'text-ink-faint' : 'text-ink-soft',
          )}
        >
          {entry.room === '' ? '—' : entry.room}
        </span>
      </span>
    </li>
  );
}
