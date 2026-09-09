'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Whether the device thinks it has a connection, said once and quietly.
 *
 * Two rules shape this, both from how badly connectivity banners usually
 * behave:
 *
 *   Nothing is shown while everything is fine. A permanent "online" chip is
 *   furniture that teaches people to ignore the one place trouble would appear.
 *
 *   Coming back is announced once and then gets out of the way. A student who
 *   walked through a stairwell does not need a banner still explaining it a
 *   minute later.
 *
 *   It says it once *on a screen*. Rendered by the two app frames rather than by
 *   the root layout, which is a correctness rule and not tidying: the offline
 *   page is already headed "You're offline", so from the root this fired there
 *   too -- repeating itself, and, being fixed to the bottom of the viewport,
 *   sitting on top of the last rows of a cached timetable with no scroll left to
 *   move them out from under it. A toast may cover content it can be scrolled
 *   away from. It may not cover the end of a list.
 *
 * `navigator.onLine` is the only signal available and it is a weak one: it
 * reports whether a network interface exists, not whether anything is
 * reachable. Captive portals and dead wifi both read as online. That is why the
 * offline message says what it can and cannot promise, and why nothing here
 * touches the freshness model — LockIn already has one authoritative answer to
 * "is this data current?", and a second one derived from a different signal
 * would eventually contradict it.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = (): boolean => navigator.onLine;

/** The server cannot know, and optimism is the safe guess: it shows nothing. */
const getServerSnapshot = (): boolean => true;

export function NetworkStatus() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (online) return undefined;
    // Having been offline is what earns the confirmation. Without this the
    // banner would flash on every cold start in a browser that reports the
    // first `online` event after hydration.
    setRestored(true);
    return undefined;
  }, [online]);

  useEffect(() => {
    if (!online || !restored) return undefined;
    const timer = setTimeout(() => {
      setRestored(false);
    }, 3200);
    return () => {
      clearTimeout(timer);
    };
  }, [online, restored]);

  const showing = !online || restored;
  if (!showing) return null;

  return (
    <div
      // Polite, not assertive: losing signal is worth knowing and is never so
      // urgent that it should interrupt what a screen reader is already saying.
      role="status"
      aria-live="polite"
      className={[
        'net-status pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3',
        // Above the tab bar and the home indicator, so it never covers the
        // navigation it is telling you not to trust.
        'bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+0.5rem)]',
        'lg:bottom-[calc(env(safe-area-inset-bottom)+1rem)]',
      ].join(' ')}
    >
      <p
        className={[
          'pointer-events-auto flex max-w-[26rem] items-center gap-2.5 rounded-sm px-3.5 py-2.5',
          'text-[12.5px] leading-snug shadow-lift-3',
          online ? 'bg-p3 text-ink-soft' : 'bg-p3 text-ink',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'size-[7px] shrink-0 rounded-[1px]',
            online ? 'bg-moss' : 'bg-terra',
          ].join(' ')}
        />
        {online ? (
          'Back online.'
        ) : (
          <span>
            <strong className="font-semibold text-ink">You are offline.</strong> Coursework already
            loaded stays readable. Syncing and opening links need a connection.
          </span>
        )}
      </p>
    </div>
  );
}
