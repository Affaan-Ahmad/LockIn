'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { cx } from '@/lib/cx';
import type { CourseView } from '@/lib/queries';

/**
 * Which courses LockIn tracks.
 *
 * The single most consequential screen in the product. An untracked course is
 * never synced, so a student who leaves last year's courses on pays for them on
 * every sync, and one who turns a current course off will never see its
 * deadlines. The copy says so plainly rather than treating this as a
 * preferences page.
 *
 * Local state until Save, deliberately. Choosing courses is a batch decision --
 * a student reviews ten and commits once -- and writing on every checkbox would
 * fire ten requests, ten re-renders and ten chances to leave the set in a state
 * the student never intended.
 */

export interface CourseTrackerProps {
  readonly courses: readonly CourseView[];
  /** First run: the copy and the primary action change, nothing else does. */
  readonly setupMode?: boolean;
}

export function CourseTracker({ courses, setupMode = false }: CourseTrackerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(
    () => new Map(courses.map((course) => [course.courseId, course.isTracked])),
    [courses],
  );
  const [tracked, setTracked] = useState<ReadonlyMap<string, boolean>>(initial);

  const changed = courses.filter(
    (course) => (tracked.get(course.courseId) ?? false) !== course.isTracked,
  );
  const selectedCount = courses.filter((course) => tracked.get(course.courseId) === true).length;

  function toggle(courseId: string) {
    setTracked((current) => {
      const next = new Map(current);
      next.set(courseId, !(current.get(courseId) ?? false));
      return next;
    });
  }

  async function save() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/courses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Only what changed. Sending all of them would rewrite decidedAt on
          // courses the student did not touch, losing when they actually chose.
          courses: changed.map((course) => ({
            courseId: course.courseId,
            isTracked: tracked.get(course.courseId) === true,
          })),
        }),
      });

      if (!response.ok) {
        setError("Couldn't save your choices. Nothing was changed.");
        return;
      }

      startTransition(() => {
        // Tracking a course does not fetch its coursework. Saying so beats a
        // student waiting for assignments that will not arrive until a sync.
        router.refresh();
        if (setupMode) router.push('/');
      });
    } catch {
      setError('Network problem. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  }

  if (courses.length === 0) {
    return (
      <p className="text-[0.9375rem] text-ink-soft">
        No courses found in your Google Classroom account yet.
      </p>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-2.5">
        {courses.map((course) => {
          const on = tracked.get(course.courseId) === true;
          const dirty = on !== course.isTracked;

          return (
            <li key={course.courseId}>
              <label
                className={cx(
                  'clay press flex cursor-pointer items-start gap-3 p-4 active:scale-[0.995]',
                  on ? 'ring-1 ring-brand/35' : '',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    toggle(course.courseId);
                  }}
                  // A real checkbox, styled. A div with role="checkbox" would
                  // have to reimplement focus, space-to-toggle and the forced
                  // colours mode that a native input gets for free.
                  className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] leading-snug font-semibold text-ink">
                    {course.name}
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] text-ink-soft">
                    {/* Google's own course-level section field, shown as-is.
                        It is frequently useless ("A,B,C,D,E,F,G", "Fall 2026"),
                        which is exactly why LockIn classifies per assignment
                        instead of trusting it. */}
                    {course.section === null || course.section.trim() === ''
                      ? 'No section listed'
                      : course.section}
                    {course.courseState === 'ARCHIVED' ? ' · Archived' : ''}
                  </span>
                </span>
                {dirty ? (
                  <span className="shrink-0 self-center text-[0.75rem] font-semibold text-brand">
                    {on ? 'Adding' : 'Removing'}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>

      <div
        className={cx(
          // Sticks to the bottom so the action is reachable without scrolling
          // back up a list of twenty courses.
          'sticky bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-10 mt-5',
          'surface-raised flex flex-wrap items-center justify-between gap-3 p-3.5',
          'md:bottom-4',
        )}
      >
        <p className="text-[0.8125rem] text-ink-soft">
          {selectedCount} of {courses.length} tracked
          {changed.length > 0 ? ` · ${String(changed.length)} unsaved` : ''}
        </p>
        <Button
          variant="primary"
          size="sm"
          busy={saving || isPending}
          disabled={changed.length === 0}
          onClick={() => void save()}
        >
          {setupMode ? 'Save and continue' : 'Save changes'}
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
