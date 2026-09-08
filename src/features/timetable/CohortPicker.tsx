'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { WHOLE_COHORT_SECTION, type CohortOption } from '@/domain/timetable';

/**
 * Which cohort and section the student is in.
 *
 * Every option comes from the published document -- the legend supplies the
 * cohorts, the classes supply the sections. Nothing is offered that the sheet
 * does not have, and nothing is guessed from the student's academic profile:
 * the programme code stored there belongs to a different naming scheme, and
 * mapping one onto the other would silently show somebody another year's week.
 *
 * This is only ever about what the timetable displays. It does not touch the
 * section that decides which coursework is relevant.
 */

export interface CohortPickerProps {
  readonly options: readonly CohortOption[];
  readonly selected: { readonly cohortLabel: string; readonly section: string } | null;
}

export function CohortPicker({ options, selected }: CohortPickerProps) {
  const router = useRouter();
  const [cohortLabel, setCohortLabel] = useState(selected?.cohortLabel ?? '');
  const [section, setSection] = useState(selected?.section ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cohort = options.find((option) => option.label === cohortLabel) ?? null;
  // Changing cohort can strand a section that the new one does not teach.
  const sections = cohort?.sections ?? [];
  // A taught masters programme is one group with no sections to choose between.
  const oneGroup = cohort !== null && sections.length === 0;
  const effectiveSection = oneGroup ? WHOLE_COHORT_SECTION : section;
  const validSection = oneGroup || (section !== '' && sections.includes(section));

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/timetable/cohort', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortLabel, section: effectiveSection }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? 'That could not be saved.');
        return;
      }
      router.refresh();
    } catch {
      setError('That could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-soft">Programme and intake</span>
        <select
          value={cohortLabel}
          onChange={(event) => {
            setCohortLabel(event.target.value);
            setSection('');
          }}
          className="min-h-10 rounded-control border border-line bg-raised px-3 text-sm text-ink"
        >
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option.label} value={option.label}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {oneGroup ? (
        <p className="text-xs text-ink-muted">
          {cohort.label} is taught as one group, so there is no section to choose.
        </p>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-soft">Section</span>
          <select
            value={section}
            onChange={(event) => setSection(event.target.value)}
            disabled={cohort === null}
            className="min-h-10 rounded-control border border-line bg-raised px-3 text-sm text-ink disabled:opacity-50"
          >
            <option value="">{cohort === null ? 'Choose a programme first' : 'Choose…'}</option>
            {sections.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}

      {error === null ? null : (
        <p role="alert" className="text-xs text-ink">
          {error}
        </p>
      )}

      <Button
        variant="primary"
        size="sm"
        disabled={!validSection || saving}
        busy={saving}
        onClick={() => void save()}
      >
        {selected === null ? 'Show my timetable' : 'Update'}
      </Button>
    </div>
  );
}
