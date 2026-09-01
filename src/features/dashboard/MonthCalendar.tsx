import Link from 'next/link';

import { cx } from '@/lib/cx';
import { deadlineDayKey, urgencyBand } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

/**
 * A month, with the days that have work on them marked.
 *
 * A Server Component with no state. The month being shown and the day being
 * filtered both live in the URL, so paging through months is a navigation the
 * back button understands and the grid never needs to hydrate.
 *
 * Deliberately not a full scheduling calendar. It shows which days carry
 * deadlines and how many, and hands off to the list beneath for the detail. A
 * grid that tried to render assignment titles inside 40px cells would be
 * unreadable at every width, and the list already does that job well.
 *
 * Undated coursework never appears. `deadlineDayKey` returns null for it, and
 * placing it on a guessed day would be inventing the one value the product
 * exists to get right.
 */

export interface MonthCalendarProps {
  readonly items: readonly AssignmentView[];
  readonly now: Date;
  readonly timeZone: string;
  /** `YYYY-MM`. The month being displayed. */
  readonly month: string;
  /** `YYYY-MM-DD` when a day is filtering the list, otherwise null. */
  readonly selectedDay: string | null;
  /** Builds the links this grid emits, so it never has to know its own route. */
  readonly hrefFor: (params: { month?: string; day?: string | null }) => string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function MonthCalendar({
  items,
  now,
  timeZone,
  month,
  selectedDay,
  hrefFor,
}: MonthCalendarProps) {
  const [year, monthIndex] = parseMonth(month);

  // Counts per day, and the most urgent band on that day, so a cell can say
  // both how much is due and how much it matters.
  const byDay = new Map<string, { count: number; overdue: boolean; today: boolean }>();
  for (const item of items) {
    const key = deadlineDayKey(item.deadline, timeZone);
    if (key === null) continue;
    const band = urgencyBand(item.deadline, now, timeZone);
    const entry = byDay.get(key) ?? { count: 0, overdue: false, today: false };
    entry.count += 1;
    if (band === 'overdue') entry.overdue = true;
    if (band === 'today') entry.today = true;
    byDay.set(key, entry);
  }

  const todayKey = localDayKey(now, timeZone);
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  // Monday-first. getUTCDay is Sunday-first, so Sunday's 0 becomes 6.
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <section aria-label="Deadlines by date" className="surface-flat p-3.5">
      <header className="mb-3 flex items-center justify-between gap-2">
        <Link
          href={hrefFor({ month: shiftMonth(year, monthIndex, -1), day: null })}
          scroll={false}
          aria-label="Previous month"
          className="press flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink"
        >
          &larr;
        </Link>
        <h2 className="text-sm font-semibold text-ink">{monthLabel(year, monthIndex)}</h2>
        <Link
          href={hrefFor({ month: shiftMonth(year, monthIndex, 1), day: null })}
          scroll={false}
          aria-label="Next month"
          className="press flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink"
        >
          &rarr;
        </Link>
      </header>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-1 text-center text-2xs font-medium text-ink-muted">
            {/* The full name is the accessible one; the column is too narrow to
                show it, so the visible text is the initial. */}
            <span aria-hidden="true">{day.charAt(0)}</span>
            <span className="sr-only">{day}</span>
          </div>
        ))}

        {cells.map((day, index) => {
          if (day === null) return <div key={`pad-${String(index)}`} aria-hidden="true" />;

          const key = `${pad(year, 4)}-${pad(monthIndex + 1, 2)}-${pad(day, 2)}`;
          const entry = byDay.get(key);
          const isToday = key === todayKey;
          const isSelected = key === selectedDay;

          const cell = (
            <span
              className={cx(
                'relative flex aspect-square w-full flex-col items-center justify-center rounded-control text-xs',
                isSelected
                  ? 'bg-brand text-on-brand'
                  : isToday
                    ? 'bg-sunken font-semibold text-ink'
                    : entry === undefined
                      ? 'text-ink-muted'
                      : 'text-ink',
                entry === undefined ? '' : 'font-medium',
              )}
            >
              {day}
              {entry === undefined ? null : (
                // A dot, not a number. The count is in the accessible label;
                // two digits inside a 32px cell beside a date is unreadable,
                // and the useful question at a glance is "is there anything",
                // not "is there one or two".
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute bottom-1 size-1 rounded-full',
                    isSelected
                      ? 'bg-on-brand'
                      : entry.overdue
                        ? 'bg-danger'
                        : entry.today
                          ? 'bg-warning'
                          : 'bg-brand',
                  )}
                />
              )}
            </span>
          );

          if (entry === undefined) {
            return (
              <div key={key} className="min-w-0">
                {cell}
              </div>
            );
          }

          return (
            <Link
              key={key}
              href={hrefFor({ month, day: isSelected ? null : key })}
              scroll={false}
              // Says what the cell means rather than repeating the number, and
              // states the count the dot deliberately omits.
              aria-label={`${String(day)} ${monthLabel(year, monthIndex)}, ${String(entry.count)} due${
                isSelected ? '. Selected, activate to clear the filter' : ''
              }`}
              className="press min-w-0 rounded-control hover:bg-sunken"
            >
              {cell}
            </Link>
          );
        })}
      </div>

      {selectedDay === null ? null : (
        <Link
          href={hrefFor({ month, day: null })}
          scroll={false}
          className="mt-3 block text-center text-xs font-medium text-brand hover:underline"
        >
          Show every date
        </Link>
      )}
    </section>
  );
}

function parseMonth(month: string): [number, number] {
  const [y, m] = month.split('-').map(Number);
  return [y ?? 1970, (m ?? 1) - 1];
}

function shiftMonth(year: number, monthIndex: number, delta: number): string {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}`;
}

function monthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthIndex, 1)));
}

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

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
