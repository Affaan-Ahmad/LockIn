'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { RefreshIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

/**
 * Runs a sync now.
 *
 * A sync is minutes of Google API calls, not milliseconds, so this deliberately
 * does not pretend to be instant. The button stays busy until the server
 * answers, and the result says what actually happened rather than "Done".
 *
 * SYNC_ALREADY_RUNNING is not treated as a failure. Two devices asking at once
 * is normal, and the lease in the database is what makes the second one safe;
 * telling the student "already running" is the truth and needs no alarm.
 */

export interface SyncButtonProps {
  /** FULL re-reads everything. Offered only where re-checking is the point. */
  readonly mode?: 'FULL' | 'INCREMENTAL';
  readonly label?: string;
}

export function SyncButton({ mode = 'INCREMENTAL', label = 'Sync now' }: SyncButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setRunning(true);
    setMessage(null);
    setFailed(false);

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const body = (await response.json()) as {
        readonly counts?: { readonly created?: number; readonly updated?: number };
        readonly error?: { readonly code?: string; readonly message?: string };
      };

      if (!response.ok) {
        const code = body.error?.code;
        if (code === 'SYNC_ALREADY_RUNNING') {
          setMessage('A sync is already running.');
        } else {
          setFailed(true);
          // The API decides what is safe to say. Anything it did not mark
          // client-safe arrives already generic, so this can be shown as-is.
          setMessage(body.error?.message ?? "Sync didn't finish.");
        }
        return;
      }

      const created = body.counts?.created ?? 0;
      const updated = body.counts?.updated ?? 0;
      setMessage(
        created === 0 && updated === 0
          ? 'Already up to date.'
          : `${String(created)} new, ${String(updated)} updated.`,
      );

      startTransition(() => {
        router.refresh();
      });
    } catch {
      setFailed(true);
      setMessage('Network problem. Try again.');
    } finally {
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
          className={cx('text-sm', failed ? 'text-danger' : 'text-ink-soft')}
        >
          {message}
        </span>
      )}
    </div>
  );
}
