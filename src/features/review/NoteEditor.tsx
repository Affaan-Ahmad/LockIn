'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { PaperButton } from '@/components/paper';
import { cx } from '@/lib/cx';

/**
 * The student's own note on one assignment.
 *
 * A client island of one textarea. The row around it stays a Server Component;
 * only this needs typing state.
 *
 * Collapsed until asked for. A textarea open on every row turns a list of
 * fifteen submitted assignments into a wall of empty boxes, and the common case
 * is reading the list, not writing to it.
 *
 * Not autosaved. Autosave on a free-text field means every pause in typing is a
 * write, and a half-finished sentence becomes the saved version if the tab
 * closes. An explicit Save is one more click and says exactly what was kept.
 */

export interface NoteEditorProps {
  readonly assignmentId: string;
  readonly initial: string | null;
  /** Names what the note is attached to, for the accessible label. */
  readonly title: string;
}

export function NoteEditor({ assignmentId, initial, title }: NoteEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const busy = saving || isPending;
  const trimmed = draft.trim();
  const stored = initial ?? '';
  const dirty = trimmed !== stored.trim();

  async function send(method: 'PUT' | 'DELETE') {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/notes', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          method === 'PUT' ? { assignmentId, body: trimmed } : { assignmentId },
        ),
      });

      if (!response.ok) {
        // Never the raw API message; the detail is already in the server log.
        setError(method === 'PUT' ? "Couldn't save that" : "Couldn't remove it");
        return;
      }

      if (method === 'DELETE') setDraft('');
      setOpen(false);
      // The server owns what the list shows. Refreshing re-reads rather than
      // letting the client guess.
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError('Network problem. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="rounded-xs px-2 py-1 text-[12px] font-semibold text-kraft-3 hover:bg-p1 hover:shadow-press focus-visible:paper-focus"
        >
          {stored === '' ? 'Add a note' : 'Edit note'}
        </button>
        {stored === '' ? null : (
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-soft" title={stored}>
            {stored}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      <label className="sr-only" htmlFor={`note-${assignmentId}`}>
        Note on {title}
      </label>
      <textarea
        id={`note-${assignmentId}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        rows={3}
        maxLength={2000}
        autoCapitalize="sentences"
        autoComplete="off"
        placeholder="What did you hand in, what is left, what did they say?"
        className={cx(
          'block w-full rounded-sm bg-p1 px-3 py-2 text-[13px] text-ink shadow-press',
          'placeholder:text-ink-faint focus-visible:paper-focus',
        )}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PaperButton
          variant="primary"
          size="sm"
          disabled={busy || trimmed === '' || !dirty}
          onClick={() => void send('PUT')}
        >
          {busy ? 'Saving…' : 'Save note'}
        </PaperButton>
        <PaperButton
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() => {
            setDraft(stored);
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </PaperButton>
        {stored === '' ? null : (
          <PaperButton
            variant="quiet"
            size="sm"
            disabled={busy}
            onClick={() => void send('DELETE')}
            className="text-terra"
          >
            Remove
          </PaperButton>
        )}
        <span className="ml-auto font-mono text-[11px] text-ink-faint tabular-nums">
          {draft.length}/2000
        </span>
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-1.5 text-[12px] font-medium text-terra">
          {error}
        </p>
      )}
    </div>
  );
}
