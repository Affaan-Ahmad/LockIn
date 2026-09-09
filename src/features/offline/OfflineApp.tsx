'use client';

import { useEffect, useState } from 'react';

import { readSnapshot, type OfflineAssignment, type OfflineDay, type OfflineSnapshot } from './store';

/**
 * The app, offline.
 *
 * Not a page — a small three-screen application built from whatever this device
 * last saw. Today, Upcoming and Timetable each have a cached view; everything
 * else says plainly that it needs a connection.
 *
 * It knows which screen was asked for because a service worker's `respondWith`
 * does not change the document's URL. Offline at `/upcoming` the address really
 * is `/upcoming`, so `location.pathname` is the intended destination and the
 * tabs below can be ordinary links: tapping one navigates, the worker serves
 * this same page at the new URL, and the right section appears. Real navigation,
 * real history, real back button — no client-side router required.
 *
 * Everything here is written so a cached view cannot be mistaken for a live one:
 * each section states its own age in words, the lists sit on recessed sheets
 * rather than the raised ones the online screens use, and there is not a single
 * control that would need the network.
 */

type Target = 'today' | 'upcoming' | 'timetable' | 'other';

const TABS: readonly { readonly href: string; readonly label: string; readonly target: Target }[] = [
  { href: '/', label: 'Today', target: 'today' },
  { href: '/upcoming', label: 'Upcoming', target: 'upcoming' },
  { href: '/timetable', label: 'Timetable', target: 'timetable' },
];

function targetFor(pathname: string): Target {
  if (pathname === '/' || pathname === '/offline') return 'today';
  if (pathname.startsWith('/upcoming')) return 'upcoming';
  if (pathname.startsWith('/timetable')) return 'timetable';
  return 'other';
}

export function OfflineApp() {
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    setTarget(targetFor(window.location.pathname));
    void readSnapshot().then(setSnapshot);
  }, []);

  // Resolves in milliseconds from local storage. A spinner that flashes for one
  // frame is worse than a beat of nothing.
  if (target === null) return null;

  return (
    <div className="w-full max-w-[34rem] text-left">
      <nav aria-label="Offline sections" className="flex flex-wrap justify-center gap-1">
        {TABS.map((tab) => {
          const active = tab.target === target;
          return (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'rounded-xs px-3 py-2 text-[12.5px] transition-[box-shadow,background-color]',
                active
                  ? 'bg-p3 font-semibold text-ink shadow-lift-1'
                  : 'bg-p1 font-medium text-ink-soft shadow-lift-0',
              ].join(' ')}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>

      <div className="mt-5">
        {target === 'today' ? <TodayView snapshot={snapshot} /> : null}
        {target === 'upcoming' ? <UpcomingView snapshot={snapshot} /> : null}
        {target === 'timetable' ? <TimetableView snapshot={snapshot} /> : null}
        {target === 'other' ? <Unavailable /> : null}
      </div>

      <p className="mt-7 text-center text-[12px] text-ink-faint">
        Reconnect and LockIn refreshes by itself — nothing here needs a tap.
      </p>
    </div>
  );
}

function Unavailable() {
  return (
    <Note>
      That screen needs a connection. Courses, review and settings all change something on the
      server, so LockIn will not pretend to offer them while it cannot reach it.
    </Note>
  );
}

function TodayView({ snapshot }: { readonly snapshot: OfflineSnapshot | null }) {
  const today = snapshot?.today;
  if (today === undefined || (today.overdue.length === 0 && today.dueSoon.length === 0)) {
    return <Nothing screen="Today" />;
  }

  return (
    <>
      <Age savedAt={today.savedAt} />
      <Assignments title="Late" items={today.overdue} timeZone={snapshot?.timeZone ?? 'UTC'} tone="terra" />
      <Assignments title="Coming up" items={today.dueSoon} timeZone={snapshot?.timeZone ?? 'UTC'} tone="edge" />
    </>
  );
}

function UpcomingView({ snapshot }: { readonly snapshot: OfflineSnapshot | null }) {
  const upcoming = snapshot?.upcoming;
  if (upcoming === undefined || (upcoming.items.length === 0 && upcoming.events.length === 0)) {
    return <Nothing screen="Upcoming" />;
  }

  const timeZone = snapshot?.timeZone ?? 'UTC';

  return (
    <>
      <Age savedAt={upcoming.savedAt} />

      {upcoming.events.length === 0 ? null : (
        <section className="mt-5">
          <Heading>Yours</Heading>
          <ul className="mt-2 overflow-hidden rounded-sm bg-p1 shadow-press">
            {upcoming.events.map((event) => (
              <li
                key={event.id}
                className="relative border-b border-edge-soft py-3 pr-4 pl-5 last:border-b-0"
              >
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-slate" />
                <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                  {event.title}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-faint">
                  <span>{event.kind.toLowerCase()}</span>
                  <span className="font-mono tabular-nums">
                    {formatDue(event.startsAt, null, timeZone)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Assignments title="Ahead" items={upcoming.items} timeZone={timeZone} tone="edge" />
    </>
  );
}

function TimetableView({ snapshot }: { readonly snapshot: OfflineSnapshot | null }) {
  const timetable = snapshot?.timetable;
  if (timetable === undefined || timetable.days.length === 0) {
    return <Nothing screen="Timetable" />;
  }

  return (
    <>
      <Age savedAt={timetable.savedAt} />
      {timetable.label === null ? null : (
        <p className="mt-1 text-center text-[12px] text-ink-faint">{timetable.label}</p>
      )}
      {timetable.days.map((day) => (
        <DayClasses key={day.weekday} day={day} />
      ))}
    </>
  );
}

function DayClasses({ day }: { readonly day: OfflineDay }) {
  if (day.classes.length === 0) return null;

  return (
    <section className="mt-5">
      <Heading>{day.weekday.toLowerCase()}</Heading>
      <ul className="mt-2 overflow-hidden rounded-sm bg-p1 shadow-press">
        {day.classes.map((entry, index) => (
          <li
            key={`${entry.courseLabel}-${String(index)}`}
            className="relative flex flex-wrap items-baseline gap-x-3 border-b border-edge-soft py-2.5 pr-4 pl-5 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 w-[3px] ${entry.cancelled ? 'bg-terra' : 'bg-edge'}`}
            />
            <span className="shrink-0 font-mono text-[12px] text-ink-soft tabular-nums">
              {formatRange(entry.startMinute, entry.endMinute)}
            </span>
            <span
              className={`min-w-0 flex-1 text-[13px] font-medium ${
                entry.cancelled ? 'text-ink-faint line-through' : 'text-ink'
              }`}
            >
              {entry.courseLabel}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-ink-faint">
              {entry.room === '' ? '—' : entry.room}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Assignments({
  title,
  items,
  timeZone,
  tone,
}: {
  readonly title: string;
  readonly items: readonly OfflineAssignment[];
  readonly timeZone: string;
  readonly tone: 'terra' | 'edge';
}) {
  if (items.length === 0) return null;

  return (
    <section className="mt-5">
      <Heading>{title}</Heading>
      <ul className="mt-2 overflow-hidden rounded-sm bg-p1 shadow-press">
        {items.map((item) => (
          <li
            key={item.assignmentId}
            className="relative border-b border-edge-soft py-3 pr-4 pl-5 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 w-[3px] ${tone === 'terra' ? 'bg-terra' : 'bg-edge'}`}
            />
            <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{item.title}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-faint">
              <span>{item.courseName}</span>
              {item.dueAtUtc === null && item.dueDateUtc === null ? null : (
                <span className="font-mono tabular-nums">
                  {formatDue(item.dueAtUtc, item.dueDateUtc, timeZone)}
                </span>
              )}
              {item.submissionState === 'TURNED_IN' || item.submissionState === 'RETURNED' ? (
                <span className="text-moss">Handed in</span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Heading({ children }: { readonly children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-ink-faint uppercase">
      {children}
    </h2>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="rounded-sm bg-p1 px-4 py-3 text-center text-[13px] leading-relaxed text-ink-soft shadow-press">
      {children}
    </p>
  );
}

function Nothing({ screen }: { readonly screen: string }) {
  return (
    <Note>
      LockIn has no saved copy of {screen} on this device yet. Open it once with a connection and it
      will be readable here next time.
    </Note>
  );
}

function Age({ savedAt }: { readonly savedAt: number }) {
  return (
    <p className="text-center text-[13px] leading-relaxed text-ink-soft">
      This is what LockIn had {describeAge(savedAt)}. It is not being checked right now, and anything
      that changed since is missing.
    </p>
  );
}

/** "a moment ago", "3 hours ago", "yesterday" — never a bare timestamp. */
function describeAge(savedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - savedAt) / 60_000));
  if (minutes < 3) return 'a moment ago';
  if (minutes < 60) return `${String(minutes)} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${String(hours)} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${String(days)} days ago`;
}

/** `08:30–09:50`, or nothing when the sheet published no time. */
function formatRange(startMinute: number | null, endMinute: number | null): string {
  if (startMinute === null) return '—';
  const clock = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return endMinute === null ? clock(startMinute) : `${clock(startMinute)}–${clock(endMinute)}`;
}

/**
 * The stored due date, in the student's own zone.
 *
 * A date with no time stays a date. The rule against inventing 23:59 holds in a
 * cache too — a remembered deadline is not a licence to guess at one.
 */
function formatDue(dueAtUtc: string | null, dueDateUtc: string | null, timeZone: string): string {
  try {
    if (dueAtUtc !== null) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(dueAtUtc));
    }
    if (dueDateUtc !== null) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'short',
      }).format(new Date(dueDateUtc));
    }
  } catch {
    // A malformed stored date is not worth breaking the page over.
  }
  return '';
}
