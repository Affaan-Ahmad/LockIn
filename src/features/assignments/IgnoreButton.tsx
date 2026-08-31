'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cx } from '@/lib/cx';

/**
 * Hide or restore one assignment.
 *
 * A client island of exactly one button. The card around it stays a Server
 * Component; only this needs a click handler and a pending state.
 *
 * Not optimistic. An optimistic hide would make the card vanish before the
 * write lands, and if the write then failed the student would believe they had
 * dealt with a missed deadline that is still outstanding. Course tracking is
 * safe to guess at; academic state is not. The delay is a few hundred
 * milliseconds and buys certainty.
 */

export interface IgnoreButtonProps {
  readonly assignmentId: string;
  readonly ignored: boolean;
  /** Used in the accessible label, so the action names what it acts on. */
  readonly title: string;
}

export function IgnoreButton({ assignmentId, ignored, title }: IgnoreButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    try {
      const response = await fetch('/api/ignored', {
        method: ignored ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId, note: null }),
      });

      if (!response.ok) {
        // Never surface a raw API message. The student gets something they can
        // act on; the detail is already in the server log.
        setError(ignored ? "Couldn't restore this" : "Couldn't hide this");
        return;
      }

      // The server owns the list. Refreshing re-runs the query rather than
      // letting the client guess at what the new list should contain.
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError('Network problem. Try again.');
    }
  }

  const busy = isPending;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={ignored ? `Restore ${title}` : `Hide ${title}`}
        className={cx(
          'press min-h-9 rounded-pill px-3 text-xs font-semibold active:scale-95',
          'transition-colors duration-[120ms] disabled:opacity-55',
          ignored
            ? 'bg-brand-soft text-brand hover:brightness-95'
            : 'text-ink-muted hover:bg-sunken hover:text-ink',
        )}
      >
        {busy ? '…' : ignored ? 'Restore' : 'Hide'}
      </button>
      {error === null ? null : (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
