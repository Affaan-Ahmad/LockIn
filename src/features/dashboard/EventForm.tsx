'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { PaperButton } from '@/components/paper';
import { USER_EVENT_KIND_LABEL, USER_EVENT_KINDS } from '@/domain/student-content/types';
import { cx } from '@/lib/cx';

/**
 * Adding something Google will never tell us about.
 *
 * The quiz announced in a lecture and never posted to Classroom is the case
 * this exists for. Everything else on this screen is read from somewhere; this
 * is the one place the student writes.
 *
 * Collapsed by default. An always-open form at the top of a list of deadlines
 * competes with the deadlines, and adding an event is the rare action on a
 * screen whose usual job is reading.
 *
 * The datetime field is a plain `datetime-local`, so the value the student types
 * is in their own zone and the browser hands it over already anchored. Sending
 * a bare wall-clock string and letting the server guess the zone is how a 9am
 * quiz becomes a 4am one.
 */

export function EventForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('QUIZ');
  const [startsAt, setStartsAt] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const busy = saving || isPending;
  const ready = title.trim() !== '' && startsAt !== '';

  function reset() {
    setTitle('');
    setKind('QUIZ');
    setStartsAt('');
    setNote('');
    setError(null);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          // `datetime-local` has no zone, so it is read as local time here and
          // sent as an instant. That is the student's own zone, which is the
          // one they typed it in.
          startsAt: new Date(startsAt).toISOString(),
          note: note.trim() === '' ? null : note.trim(),
        }),
      });

      if (!response.ok) {
        setError("Couldn't add that");
        return;
      }

      reset();
      setOpen(false);
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
      <PaperButton
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add your own
      </PaperButton>
    );
  }

  const field = cx(
    'block w-full rounded-sm bg-p1 px-3 py-2 text-[13px] text-ink shadow-press',
    'placeholder:text-ink-faint focus-visible:paper-focus',
  );

  return (
    <form
      className="w-full rounded-sm bg-p3 p-4 shadow-lift-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="event-title" className="mb-1 block text-[12px] font-medium text-ink-soft">
            What is it?
          </label>
          <input
            id="event-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            maxLength={120}
            required
            placeholder="Data Structures quiz 2"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="event-kind" className="mb-1 block text-[12px] font-medium text-ink-soft">
            Kind
          </label>
          <select
            id="event-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
            className={field}
          >
            {USER_EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {USER_EVENT_KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="event-when" className="mb-1 block text-[12px] font-medium text-ink-soft">
            When
          </label>
          <input
            id="event-when"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => {
              setStartsAt(e.target.value);
            }}
            required
            className={field}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="event-note" className="mb-1 block text-[12px] font-medium text-ink-soft">
            Note <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input
            id="event-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            maxLength={500}
            placeholder="Chapters 4 to 6, in the lab"
            className={field}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PaperButton type="submit" variant="primary" size="sm" disabled={!ready || busy}>
          {busy ? 'Adding…' : 'Add to calendar'}
        </PaperButton>
        <PaperButton
          type="button"
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </PaperButton>
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-2 text-[12px] font-medium text-terra">
          {error}
        </p>
      )}
    </form>
  );
}
