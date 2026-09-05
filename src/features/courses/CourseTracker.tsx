'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
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
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState(false);
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
    setSaved(false);
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
    setSaved(false);

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

      setSaved(true);
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
      <p className="text-base text-ink-soft">
        No courses found in your Google Classroom account yet.
      </p>
    );
  }

  const visible = courses.filter((course) =>
    `${course.name} ${course.section ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  return (
    <div>
      <div className="course-toolbar">
        <label className="course-search">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Find a course</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Course name or section" />
        </label>
        <p className="text-sm text-ink-soft" aria-live="polite">{visible.length} courses shown</p>
      </div>
      <ul className="course-list">
        {visible.map((course) => {
          const on = tracked.get(course.courseId) === true;
          const dirty = on !== course.isTracked;
          return (
            <li key={course.courseId}>
              <label className="course-choice">
                <input type="checkbox" checked={on} disabled={saving || isPending}
                  onChange={() => toggle(course.courseId)} />
                <span className="min-w-0">
                  <span className="course-name">{course.name}</span>
                  <span className="course-section">
                    {course.section?.trim() || 'No section listed'}
                    {course.courseState === 'ARCHIVED' ? ' · Archived' : ''}
                    {course.courseState !== null && !['ACTIVE', 'ARCHIVED'].includes(course.courseState)
                      ? ` · ${course.courseState.replaceAll('_', ' ').toLowerCase()}` : ''}
                  </span>
                </span>
                <span className="course-state" data-tracked={on}>
                  {dirty ? (on ? 'Adding' : 'Removing') : on ? 'Tracked' : 'Not tracked'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 ? <p className="py-8 text-sm text-ink-soft">No courses match. Try another name or clear your search.</p> : null}
      <div className="course-save">
        <p className="text-sm text-ink-soft">
          {selectedCount} of {courses.length} selected
          {changed.length > 0 ? ` · ${changed.length} unsaved` : ''}
        </p>
        <Button variant="primary" size="sm" busy={saving || isPending}
          disabled={changed.length === 0} onClick={() => void save()}>
          {setupMode ? 'Save and continue' : 'Save changes'}
        </Button>
      </div>
      {saved && changed.length === 0 ? <p role="status" className="mt-3 text-sm text-ink-soft">Course choices saved. New coursework appears after the next sync.</p> : null}
      {error === null ? null : <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}
