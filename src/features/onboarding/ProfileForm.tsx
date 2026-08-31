'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';
import { cx } from '@/lib/cx';

/**
 * The student's section, and what LockIn will match on because of it.
 *
 * This is the input the entire classifier runs on. Get it wrong and every
 * verdict is wrong, so the form shows the generated aliases back -- "we will
 * look for G, Sec G, Section G, 5G" -- rather than asking the student to trust
 * a rule they cannot see.
 *
 * The aliases shown here are produced by the same domain function the server
 * uses, imported, not reimplemented. A second copy of that logic in the browser
 * would drift, and the drift would be invisible until it hid someone's exam.
 */

export interface ProfileFormProps {
  readonly initial: {
    readonly primarySection: string;
    readonly programCode: string | null;
    readonly batch: string | null;
    readonly timeZone: string;
    readonly extraAliases: readonly string[];
  } | null;
  /** Where to go after a successful save. Onboarding and settings differ. */
  readonly nextHref: string;
  readonly submitLabel: string;
}

function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // UTC rather than a guess. A wrong zone shifts every deadline boundary.
    return 'UTC';
  }
}

export function ProfileForm({ initial, nextHref, submitLabel }: ProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [section, setSection] = useState(initial?.primarySection ?? '');
  const [programCode, setProgramCode] = useState(initial?.programCode ?? '');
  const [batch, setBatch] = useState(initial?.batch ?? '');
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? detectTimeZone());
  const [extra, setExtra] = useState((initial?.extraAliases ?? []).join(', '));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same domain function the classifier runs on, imported rather than
  // reimplemented. A second copy of this logic in the browser would drift, and
  // the drift would stay invisible until it hid someone's exam.
  const aliases = useMemo(() => {
    const trimmed = section.trim();
    if (trimmed === '') return [];

    const generated = buildStudentSectionProfile({
      primarySection: trimmed,
      programCode: programCode.trim() === '' ? null : programCode.trim(),
      batch: batch.trim() === '' ? null : batch.trim(),
    }).aliases.map((alias) => alias.raw);

    const manual = extra
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '');

    return [...new Set([...generated, ...manual])];
  }, [section, programCode, batch, extra]);

  async function save() {
    const trimmed = section.trim();
    if (trimmed === '') {
      setError('Your section is required. Without it LockIn cannot tell your work apart.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primarySection: trimmed,
          programCode: programCode.trim() === '' ? null : programCode.trim(),
          batch: batch.trim() === '' ? null : batch.trim(),
          university: null,
          timeZone,
          extraAliases: extra
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value !== ''),
        }),
      });

      const body = (await response.json()) as {
        readonly error?: { readonly message?: string };
      };

      if (!response.ok) {
        setError(body.error?.message ?? "Couldn't save. Nothing was changed.");
        return;
      }

      startTransition(() => {
        router.push(nextHref);
        router.refresh();
      });
    } catch {
      setError('Network problem. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-5"
    >
      <Field
        label="Your section"
        hint="Just the label your teachers use, like G or B2."
        value={section}
        onChange={setSection}
        required
        maxLength={8}
        autoCapitalize="characters"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Programme code"
          hint="Optional. BSCS, BSSE, and so on."
          value={programCode}
          onChange={setProgramCode}
          maxLength={16}
        />
        <Field
          label="Batch"
          hint="Optional. The year you started, like 24."
          value={batch}
          onChange={setBatch}
          maxLength={8}
        />
      </div>

      <Field
        label="Time zone"
        hint="Decides when a deadline counts as today. Detected from your device."
        value={timeZone}
        onChange={setTimeZone}
        required
      />

      <Field
        label="Other spellings your teachers use"
        hint="Optional, comma separated. Add one only if a teacher writes your section a way LockIn would not guess."
        value={extra}
        onChange={setExtra}
      />

      <div className="surface-sunken p-3.5">
        <p className="text-[0.8125rem] font-semibold text-ink">
          What LockIn will look for in a post
        </p>
        {aliases.length === 0 ? (
          <p className="mt-1.5 text-[0.8125rem] text-ink-muted">
            Enter your section to see this.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {aliases.map((alias) => (
              <li
                key={alias}
                className="rounded-pill bg-raised px-2.5 py-1 text-[0.75rem] font-semibold text-ink"
              >
                {alias}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2.5 text-[0.75rem] leading-relaxed text-ink-muted">
          A post that mentions none of these is treated as being for everyone. Anything LockIn
          cannot read confidently goes to Review for you to decide. It is never guessed
          at.
        </p>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-[0.875rem] font-medium text-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" busy={saving || isPending} fullWidth>
        {submitLabel}
      </Button>
    </form>
  );
}

interface FieldProps {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly autoCapitalize?: 'none' | 'characters';
}

function Field({
  label,
  hint,
  value,
  onChange,
  required = false,
  maxLength,
  autoCapitalize = 'none',
}: FieldProps) {
  const id = `field-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[0.875rem] font-semibold text-ink">
        {label}
        {required ? null : <span className="ml-1.5 font-normal text-ink-muted">optional</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        required={required}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        className={cx(
          'surface-sunken mt-1.5 min-h-11 w-full rounded-control px-3.5 text-[0.9375rem] text-ink',
          'outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-brand',
        )}
      />
      <p id={`${id}-hint`} className="mt-1 text-[0.75rem] text-ink-muted">
        {hint}
      </p>
    </div>
  );
}
