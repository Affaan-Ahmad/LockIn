'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { CloseIcon } from '@/components/icons';

/**
 * Removes one of the student's own entries.
 *
 * A client island of one button, so the card stays a Server Component.
 *
 * No confirmation dialog. This is a reminder somebody typed in, not coursework
 * — it costs one sentence to retype, and a modal for it would be the same
 * ceremony account deletion gets. It is also the only destructive control on
 * this screen, which is why it is an icon at the edge rather than a button in
 * the flow: hard to hit by accident, easy to find on purpose.
 */

export interface EventDeleteButtonProps {
  readonly eventId: string;
  /** Names what is being removed, so the label is not just "Remove". */
  readonly title: string;
}

export function EventDeleteButton({ eventId, title }: EventDeleteButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function remove() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });

      if (!response.ok) {
        setError(true);
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy || isPending}
      aria-label={`Remove ${title}`}
      title={error ? "Couldn't remove that" : `Remove ${title}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-xs text-ink-faint transition-colors hover:bg-p1 hover:text-terra hover:shadow-press focus-visible:paper-focus disabled:opacity-50"
    >
      <CloseIcon className="size-4" />
    </button>
  );
}
