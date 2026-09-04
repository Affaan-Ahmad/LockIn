'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import type { FreshnessLevel } from '@/domain/sync/freshness';
import { cooldownElapsed, shouldAutoSync } from '@/features/sync/auto-sync';

/**
 * Refreshes Classroom when the student opens a screen and the data is old.
 *
 * The scheduler that is not there, and deliberately. Vercel's free tier caps
 * cron at once per day with an hour of jitter, which for a deadline product is
 * close to useless -- an assignment posted at nine could sit unseen until the
 * following afternoon. Syncing on arrival instead makes the data fresh at the
 * only moment freshness is worth anything: when somebody is looking at it. It
 * also costs nothing, has no quota, and needs no secret to be configured
 * correctly for it to work.
 *
 * What it does not do is block. The page has already rendered with whatever was
 * stored, exactly as before; this runs afterwards and swaps the data in when it
 * arrives. A student who opens the app to check one deadline is never made to
 * wait for a network round trip to Google to see it.
 *
 * Silent about the ordinary. "A sync is already running" and "rate limited" are
 * both normal outcomes of automatic behaviour -- two tabs, a quick revisit --
 * and neither is something a student did or can act on. The freshness banner
 * already says the data is old; this does not also need to complain.
 */

/** Shared across tabs, so two open windows do not both fire. */
const LAST_ATTEMPT_KEY = 'lockin.autosync.lastAttemptAt';

/** Matches SyncButton. Frequent enough to feel live, rare enough to be cheap. */
const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_MS = 3 * 60 * 1000;

function readLastAttempt(): string | null {
  try {
    return window.localStorage.getItem(LAST_ATTEMPT_KEY);
  } catch {
    // Private mode, blocked site data, a thumbnailer. Absent storage means no
    // cooldown, which costs at most one extra sync.
    return null;
  }
}

function recordAttempt(now: number): void {
  try {
    window.localStorage.setItem(LAST_ATTEMPT_KEY, String(now));
  } catch {
    // Nothing to do. Without storage the cooldown is simply not enforced.
  }
}

export interface AutoSyncProps {
  readonly level: FreshnessLevel;
}

export function AutoSync({ level }: AutoSyncProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  // One attempt per mount, whatever React does with effects. Without this the
  // development double-invoke fires two syncs, and the second is refused by the
  // lease in a way that looks like a bug.
  const attempted = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    if (attempted.current || !shouldAutoSync(level)) return;
    if (!cooldownElapsed(readLastAttempt(), Date.now())) return;

    attempted.current = true;
    recordAttempt(Date.now());

    void (async () => {
      setRunning(true);
      try {
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'INCREMENTAL' }),
        });
        const body = (await response.json()) as { readonly syncRunId?: string };

        // Any refusal is silent. A live run elsewhere, a rate limit, an expired
        // grant: none of these are things this student just did.
        if (!response.ok || body.syncRunId === undefined) return;

        const deadline = Date.now() + MAX_POLL_MS;
        while (!cancelled.current && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (cancelled.current) return;

          try {
            const status = await fetch(`/api/sync/${body.syncRunId}`, { cache: 'no-store' });
            if (!status.ok) continue;
            const progress = (await status.json()) as { readonly complete?: boolean };
            if (progress.complete !== true) continue;
          } catch {
            continue;
          }

          // Whatever the outcome, the stored data and the freshness banner have
          // both moved on. Re-render against them rather than deciding here
          // what the run meant -- the server already knows.
          startTransition(() => {
            router.refresh();
          });
          return;
        }
      } catch {
        // Offline, or the tab went away mid-request. The page is still showing
        // real data and the banner still says how old it is.
      } finally {
        if (!cancelled.current) setRunning(false);
      }
    })();
  }, [level, router]);

  if (!running) return null;

  return (
    <p role="status" className="flex items-center gap-2 text-xs text-ink-muted">
      <span
        aria-hidden="true"
        className="size-1.5 animate-pulse rounded-full bg-brand-ink"
      />
      Updating Classroom…
    </p>
  );
}
