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
    <ul className="divide-y divide-line overflow-hidden rounded-control border border-line bg-raised">
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
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
      <span
        className={cx(
          'shrink-0 font-mono text-sm whitespace-nowrap tabular-nums',
          // A twelve-hour range is half again as wide as "08:30-09:50", and a
          // fixed column sized for the latter wrapped every row in two.
          timeFormat === '12' ? 'w-[9.5rem]' : 'w-[7.5rem]',
          cancelled ? 'text-ink-muted' : 'text-ink-soft',
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
            'text-base font-medium',
            cancelled ? 'text-ink-muted line-through' : 'text-ink',
          )}
        >
          {entry.courseLabel}
        </span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
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

      <span className="flex shrink-0 items-center gap-2">
        {cancelled ? <Chip tone="alert">Cancelled</Chip> : null}
        {match.confidence === 'POSSIBLE' ? (
          <Chip
            tone="muted"
            title={
              match.reason === 'LAB_SUBGROUP'
                ? 'The sheet does not say which subgroup you are in, so both are shown.'
                : 'This is in your cohort, but the sheet does not name a section.'
            }
          >
            Check
          </Chip>
        ) : null}
        <span className={cx('text-sm', cancelled ? 'text-ink-muted' : 'text-ink-soft')}>
          {entry.room === '' ? '—' : entry.room}
        </span>
      </span>
    </li>
  );
}

function Chip({
  tone,
  title,
  children,
}: {
  readonly tone: 'muted' | 'alert';
  readonly title?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cx(
        'rounded-pill px-2 py-0.5 text-2xs font-semibold',
        tone === 'alert' ? 'bg-review text-on-fill' : 'bg-sunken text-ink-muted',
      )}
    >
      {children}
    </span>
  );
}
