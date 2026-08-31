/**
 * Deadline formatting.
 *
 * The rule this file exists to enforce: **never render a time the student was
 * not given.** Google returns a due date and a due time as separately optional
 * fields, and the backend preserves that distinction as `precision`. A
 * formatter that quietly printed "11:59 PM" for a date-only deadline would
 * fabricate the single most consequential value in the product.
 *
 * Everything here is pure and runs on the server. `Intl` is built in, so there
 * is no date library in the bundle.
 */

export type DuePrecision = 'EXACT' | 'DATE_ONLY' | 'NONE';

export interface ApiDeadline {
  readonly precision: DuePrecision;
  readonly dueAtUtc: string | null;
  readonly dueDateUtc: string | null;
}

export type UrgencyBand = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'none';

export interface FormattedDeadline {
  /** "11:59 PM", or "No time given" when Google supplied only a date. */
  readonly time: string | null;
  /** "Today", "Tomorrow", "Fri 5 Sep". */
  readonly day: string;
  /** "in 3 hours", "2 days ago". Null when there is no instant to measure. */
  readonly relative: string | null;
  readonly band: UrgencyBand;
  /** For <time dateTime>. */
  readonly machine: string | null;
}

const MS_DAY = 86_400_000;

/**
 * Calendar date in a given zone.
 *
 * Intl rather than offset arithmetic, because only Intl knows when a zone
 * changed its rules or crossed a DST boundary. Getting this wrong shifts every
 * "Today" heading by a day for anyone not on UTC.
 */
function localParts(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Map<string, string>(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type as string, part.value]),
  );
  return {
    y: Number(parts.get('year') ?? '0'),
    m: Number(parts.get('month') ?? '0'),
    d: Number(parts.get('day') ?? '0'),
  };
}

function daysBetween(from: Date, to: Date, timeZone: string): number {
  const a = localParts(from, timeZone);
  const b = localParts(to, timeZone);
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / MS_DAY,
  );
}

/**
 * Which urgency band a deadline falls in.
 *
 * Bands are calendar-relative, not duration-relative: something due at 1am
 * tomorrow is "Tomorrow", not "in 4 hours", because that is how a student
 * thinks about it. Overdue is decided by the instant when there is one, and by
 * calendar date when there is not -- a date-only item is not late until that
 * day has ended locally.
 */
export function urgencyBand(
  deadline: ApiDeadline,
  now: Date,
  timeZone: string,
): UrgencyBand {
  if (deadline.precision === 'NONE') return 'none';

  if (deadline.precision === 'EXACT' && deadline.dueAtUtc !== null) {
    const due = new Date(deadline.dueAtUtc);
    if (due.getTime() < now.getTime()) return 'overdue';
    const offset = daysBetween(now, due, timeZone);
    if (offset <= 0) return 'today';
    if (offset === 1) return 'tomorrow';
    return offset <= 7 ? 'thisWeek' : 'later';
  }

  if (deadline.dueDateUtc === null) return 'none';
  const [y, m, d] = deadline.dueDateUtc.split('-').map(Number);
  const today = localParts(now, timeZone);
  const offset = Math.round(
    (Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) - Date.UTC(today.y, today.m - 1, today.d)) / MS_DAY,
  );

  if (offset < 0) return 'overdue';
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return offset <= 7 ? 'thisWeek' : 'later';
}

export function formatDeadline(
  deadline: ApiDeadline,
  now: Date,
  timeZone: string,
): FormattedDeadline {
  const band = urgencyBand(deadline, now, timeZone);

  if (deadline.precision === 'NONE') {
    return { time: null, day: 'No due date', relative: null, band, machine: null };
  }

  const instant =
    deadline.precision === 'EXACT' && deadline.dueAtUtc !== null
      ? new Date(deadline.dueAtUtc)
      : null;

  const dayDate =
    instant ??
    (deadline.dueDateUtc === null ? null : new Date(`${deadline.dueDateUtc}T12:00:00Z`));

  if (dayDate === null) {
    return { time: null, day: 'No due date', relative: null, band, machine: null };
  }

  const offset =
    instant !== null
      ? daysBetween(now, instant, timeZone)
      : (() => {
          const [y, m, d] = (deadline.dueDateUtc ?? '').split('-').map(Number);
          const today = localParts(now, timeZone);
          return Math.round(
            (Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) - Date.UTC(today.y, today.m - 1, today.d)) /
              MS_DAY,
          );
        })();

  let day: string;
  if (offset === 0) day = 'Today';
  else if (offset === 1) day = 'Tomorrow';
  else if (offset === -1) day = 'Yesterday';
  else {
    day = new Intl.DateTimeFormat('en-GB', {
      timeZone: instant === null ? 'UTC' : timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(dayDate);
  }

  return {
    // The whole point of the file. A date-only deadline says so in words
    // rather than borrowing a plausible-looking time.
    time:
      instant === null
        ? 'No time given'
        : new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(instant),
    day,
    relative: instant === null ? null : relativeTime(instant, now),
    band,
    machine: instant?.toISOString() ?? deadline.dueDateUtc,
  };
}

/** "in 3 hours", "2 days ago". Uses Intl so it is localisable and free. */
function relativeTime(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

  if (abs < 60_000) return 'now';
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < MS_DAY) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / MS_DAY), 'day');
}

/** "4 min ago" for the sync indicator. */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return 'never';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} hr ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'} ago`;
}
