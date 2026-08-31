'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cx } from '@/lib/cx';

/**
 * The student's answer to "is this yours?".
 *
 * Writes a classification override, which the sync pipeline can read but has no
 * write path to. That is what makes "a sync will not erase what I decided" a
 * property of the system rather than a promise, and it is why this is a
 * different control from Hide: this one is a statement about the coursework,
 * Hide is a statement about the student's attention.
 *
 * Only two answers, plus undo. "Not sure" is the absence of an override, which
 * is where the item already is -- offering it as a button would let a student
 * think they had answered when they had not.
 */

export interface RelevanceChoiceProps {
  readonly assignmentId: string;
  /** Present when the student has already answered, so the answer can be undone. */
  readonly current: 'RELEVANT' | 'NOT_RELEVANT' | null;
  readonly title: string;
}

export function RelevanceChoice({ assignmentId, current, title }: RelevanceChoiceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(relevance: 'RELEVANT' | 'NOT_RELEVANT' | null) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/overrides', {
        method: relevance === null ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          relevance === null ? { assignmentId } : { assignmentId, relevance, note: null },
        ),
      });

      if (!response.ok) {
        setError("Couldn't save that. Nothing was changed.");
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError('Network problem. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || isPending;

  if (current !== null) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <p className="text-sm text-ink-soft">
          You said this is{' '}
          <strong className="font-semibold text-ink">
            {current === 'RELEVANT' ? 'yours' : 'not yours'}
          </strong>
          .
        </p>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={`Undo your answer for ${title}`}
          onClick={() => void choose(null)}
          className="press min-h-9 rounded-control px-3 text-xs font-medium text-ink-muted hover:bg-sunken hover:text-ink  disabled:opacity-50"
        >
          {pending ? '…' : 'Undo'}
        </button>
        {error === null ? null : (
          <span role="alert" className="text-xs font-medium text-danger">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm text-ink-soft">Is this yours?</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Choice
          label="Yes, it's mine"
          tone="brand"
          disabled={pending}
          onClick={() => void choose('RELEVANT')}
          describedBy={title}
        />
        <Choice
          label="No, not my section"
          tone="plain"
          disabled={pending}
          onClick={() => void choose('NOT_RELEVANT')}
          describedBy={title}
        />
        {error === null ? null : (
          <span role="alert" className="text-xs font-medium text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function Choice({
  label,
  tone,
  disabled,
  onClick,
  describedBy,
}: {
  readonly label: string;
  readonly tone: 'brand' | 'plain';
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly describedBy: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}: ${describedBy}`}
      className={cx(
        'press min-h-11 rounded-control px-4 text-sm font-medium active:translate-y-px',
        ' disabled:opacity-50',
        tone === 'brand'
          ? 'bg-brand text-on-brand shadow-clay hover:bg-brand-hover'
          : 'surface-raised text-ink hover:bg-overlay',
      )}
    >
      {label}
    </button>
  );
}
