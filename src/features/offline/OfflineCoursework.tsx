'use client';

import { useEffect, useState } from 'react';

import { PaperButtonLink } from '@/components/paper';
import { readSnapshot, type OfflineAssignment, type OfflineSnapshot } from './store';

/**
 * The last coursework this device saw, shown when the network is gone.
 *
 * Everything here is written to make one thing unmistakable: this is a memory,
 * not a reading. The heading says offline, the age is stated in words rather
 * than implied by a timestamp, and the list is set on a recessed sheet instead
 * of the raised ones the live screens use, so it does not look like Today.
 *
 * There is no submit button, no link out, no sync control. Every one of those
 * needs a network, and offering an action that cannot run is worse than not
 * offering it — the student would take the tap as progress.
 *
 * When there is nothing stored, this says so plainly rather than inventing an
 * empty state that could be mistaken for "nothing is due".
 */

type Phase = 'loading' | 'ready' | 'empty';

export function OfflineCoursework() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await readSnapshot();
      const hasWork =
        stored !== null && (stored.overdue.length > 0 || stored.dueSoon.length > 0);
      setSnapshot(stored);
      setPhase(hasWork ? 'ready' : 'empty');
    })();
  }, []);

  if (phase === 'loading') {
    // Deliberately blank. This resolves in a few milliseconds from local
    // storage, and a spinner that flashes is worse than nothing at all.
    return null;
  }

  if (phase === 'empty' || snapshot === null) {
    return (
      <>
        <p className="max-w-[34ch] text-[13.5px] leading-relaxed text-ink-soft">
          LockIn has nothing saved on this device yet. Open it once with a connection and your
          deadlines will be readable here next time.
        </p>
        <PaperButtonLink href="/" variant="secondary" size="md" className="mt-2">
          Try again
        </PaperButtonLink>
      </>
    );
  }

  return (
    <div className="w-full max-w-[34rem] text-left">
      <p className="text-center text-[13px] leading-relaxed text-ink-soft">
        This is what LockIn had {describeAge(snapshot.savedAt)}. It is not being checked right now,
        and anything posted since is missing.
      </p>

      <Section title="Late" items={snapshot.overdue} timeZone={snapshot.timeZone} tone="terra" />
      <Section title="Coming up" items={snapshot.dueSoon} timeZone={snapshot.timeZone} tone="edge" />

      <p className="mt-6 text-center text-[12px] text-ink-faint">
        Reconnect to see what is actually current — LockIn will refresh by itself the moment it can.
      </p>
    </div>
  );
}

function Section({
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
    <section className="mt-6">
      <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        {title}
      </h2>
      {/* Recessed, not raised. The live screens stack their coursework on sheets
          that stand off the page; this is pressed into it, so a glance can tell
          the two apart without reading the banner. */}
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

/** "a few minutes ago", "3 hours ago", "yesterday" — never a bare timestamp. */
function describeAge(savedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - savedAt) / 60_000));
  if (minutes < 3) return 'a moment ago';
  if (minutes < 60) return `${String(minutes)} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${String(hours)} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${String(days)} days ago`;
}

/**
 * The stored due date, in the student's own zone.
 *
 * A date with no time stays a date. The product's rule about never inventing
 * 23:59 holds here too — a cached view is not a licence to guess.
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
