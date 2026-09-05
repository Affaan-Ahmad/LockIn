'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { RefreshIcon } from '@/components/icons';
import type { SyncCounts, SyncRunStatus } from '@/domain/sync/outcome';
import { describeSyncOutcome, type SyncPresentation } from '@/features/sync/outcome-message';
import { cx } from '@/lib/cx';

/**
 * Runs a sync and reports what actually happened.
 *
 * The server no longer finishes the work inside the request -- it claims a run,
 * answers 202 with an id, and synchronises in the background. So this polls a
 * status endpoint instead of reading a single response, which also means
 * closing the tab no longer has any effect on the sync. It stops watching; the
 * work carries on.
 *
 * The status comes from the server and is never inferred. Deriving "it worked"
 * from a 200, or from counts of zero, is exactly how a run that failed on every
 * course used to be reported as "Already up to date." -- a claim that the
 * deadlines on screen are current, made at the moment they stopped being.
 */

export interface SyncButtonProps {
  /** FULL re-reads everything. Offered only where re-checking is the point. */
  readonly mode?: 'FULL' | 'INCREMENTAL';
  readonly label?: string;
}

interface StatusResponse {
  readonly status?: SyncRunStatus;
  readonly complete?: boolean;
  readonly counts?: Partial<SyncCounts>;
  readonly issueCodes?: readonly string[];
  readonly progress?: {
    readonly totalCourses?: number;
    readonly completedCourses?: number;
  };
}

/** Frequent enough to feel live, rare enough not to be a load generator. */
const POLL_INTERVAL_MS = 2_000;
/**
 * A run can legitimately outlive the page: it spans invocations and may be
 * finished by a continuation minutes later. Watching forever would leave a
 * timer running on a screen nobody is looking at, so this gives up watching --
 * which is not the same as giving up on the sync.
 */
const MAX_POLL_MS = 5 * 60 * 1000;

export function SyncButton({ mode = 'INCREMENTAL', label = 'Sync now' }: SyncButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<SyncPresentation | null>(null);

  // Polling must stop when the component goes away, or it keeps fetching
  // against a page that no longer exists.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const watch = useCallback(
    async (syncRunId: string) => {
      const deadline = Date.now() + MAX_POLL_MS;
      let failures = 0;

      while (!cancelled.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelled.current) return;

        let body: StatusResponse;
        try {
          const response = await fetch(`/api/sync/${syncRunId}`, { cache: 'no-store' });
          if (!response.ok) {
            failures += 1;
            if (failures >= 4) {
              // Four consecutive refusals is no longer a blip. The run may well
              // be fine, but this screen has stopped being able to say so, and
              // pretending otherwise is what makes a button look frozen.
              setMessage('Still working. Refresh to see where it got to.');
            }
            continue;
          }
          failures = 0;
          body = (await response.json()) as StatusResponse;
        } catch {
          // A dropped poll says nothing about the run, which is running on the
          // server regardless. Keep watching.
          failures += 1;
          continue;
        }

        if (body.complete !== true) {
          const done = body.progress?.completedCourses ?? 0;
          const total = body.progress?.totalCourses ?? 0;
          setMessage(
            total > 0
              ? `Updating Classroom… ${String(done)}/${String(total)} courses`
              : 'Updating Classroom…',
          );
          continue;
        }

        const outcome = describeSyncOutcome(
          body.status,
          body.counts,
          (body.issueCodes ?? []).map((code) => ({ code })),
        );
        setPresentation(outcome.presentation);
        setMessage(outcome.text);
        setRunning(false);

        startTransition(() => {
          router.refresh();
        });
        return;
      }

      if (!cancelled.current) {
        setRunning(false);
        // Honest: we stopped watching, the sync did not stop.
        setPresentation('IN_PROGRESS');
        setMessage('Still updating. Refresh in a minute to see the result.');
      }
    },
    [router],
  );

  async function run() {
    setRunning(true);
    setMessage('Starting…');
    setPresentation('IN_PROGRESS');

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const body = (await response.json()) as {
        readonly syncRunId?: string;
        readonly error?: { readonly code?: string; readonly message?: string };
      };

      if (!response.ok) {
        const code = body.error?.code;
        if (code === 'SYNC_ALREADY_RUNNING') {
          // Not a failure. Two devices asking at once is normal, and the lease
          // in the database is what makes the second one safe.
          setPresentation('IN_PROGRESS');
          setMessage('A sync is already running.');
        } else {
          setPresentation('FAILED');
          // The API decides what is safe to say; anything not marked
          // client-safe arrives already generic.
          setMessage(body.error?.message ?? "Sync didn't start.");
        }
        setRunning(false);
        return;
      }

      if (body.syncRunId === undefined) {
        setPresentation('FAILED');
        setMessage("Sync didn't start.");
        setRunning(false);
        return;
      }

      // The run exists as soon as the POST answers. Saying so immediately
      // matters because the poll below only updates the message on a *good*
      // response: a refused or failing poll leaves the previous text on screen,
      // and "Starting…" that never changes reads as a frozen button rather than
      // as work in progress.
      setMessage('Updating Classroom…');
      await watch(body.syncRunId);
    } catch {
      setPresentation('FAILED');
      setMessage('Network problem. Try again.');
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" busy={running || isPending} onClick={() => void run()}>
        <RefreshIcon className="size-4" aria-hidden="true" />
        {label}
      </Button>
      {message === null ? null : (
        <span
          role="status"
          className={cx(
            'text-sm',
            presentation === 'FAILED'
              ? 'text-danger'
              : presentation === 'PARTIAL'
                ? 'text-warning'
                : 'text-ink-soft',
          )}
        >
          {message}
        </span>
      )}
    </div>
  );
}
