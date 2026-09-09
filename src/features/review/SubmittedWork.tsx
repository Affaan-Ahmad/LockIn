import Link from 'next/link';

import { Caption, PaperBadge, RecessedWell } from '@/components/paper';
import type { AssignmentNote } from '@/domain/student-content/types';
import type { TimeFormat } from '@/lib/clock';
import { cx } from '@/lib/cx';
import { formatDeadline } from '@/lib/format';
import type { AssignmentView, CourseView } from '@/lib/queries';

import { NoteEditor } from './NoteEditor';

/**
 * What the student has already handed in, by course, with room to annotate it.
 *
 * The review queue above this answers a question LockIn has. This answers one
 * the student has, and it is the reason the screen is worth opening when the
 * queue is empty — which, for anyone whose sections are unambiguous, is almost
 * always.
 *
 * The course filter lives in the URL rather than in client state. That keeps the
 * whole thing a Server Component, makes a filtered view shareable, and means the
 * back button undoes a filter instead of leaving the page.
 */

export interface SubmittedWorkProps {
  readonly items: readonly AssignmentView[];
  readonly notes: ReadonlyMap<string, AssignmentNote>;
  readonly courses: readonly CourseView[];
  /** Course id from the URL, or null for everything. */
  readonly selectedCourseId: string | null;
  readonly now: Date;
  readonly timeZone: string;
  readonly timeFormat: TimeFormat;
}

export function SubmittedWork({
  items,
  notes,
  courses,
  selectedCourseId,
  now,
  timeZone,
  timeFormat,
}: SubmittedWorkProps) {
  // Only courses that actually have submitted work. A filter offering a course
  // that yields an empty list is a filter that wastes a tap to tell you nothing.
  const countByCourse = new Map<string, number>();
  for (const item of items) {
    countByCourse.set(item.courseId, (countByCourse.get(item.courseId) ?? 0) + 1);
  }

  const filters = courses
    .filter((course) => countByCourse.has(course.courseId))
    .map((course) => ({
      id: course.courseId,
      name: course.name,
      count: countByCourse.get(course.courseId) ?? 0,
    }));

  const shown =
    selectedCourseId === null
      ? items
      : items.filter((item) => item.courseId === selectedCourseId);

  return (
    <section aria-labelledby="submitted-heading" className="mt-10">
      <div className="flex items-center gap-3">
        <Caption>
          <span id="submitted-heading">Handed in</span>
        </Caption>
        <span aria-hidden="true" className="h-px flex-1 bg-edge-soft" />
        <span className="font-mono text-[11.5px] text-ink-faint tabular-nums">{shown.length}</span>
      </div>

      {items.length === 0 ? (
        <RecessedWell className="mt-3 px-5 py-8 text-center">
          <p className="text-[13px] text-ink-soft">
            Nothing is marked as handed in yet. Work you submit in Classroom appears here after the
            next sync, and you can keep your own notes on it.
          </p>
        </RecessedWell>
      ) : (
        <>
          <nav aria-label="Filter by course" className="mt-3 flex flex-wrap gap-1.5">
            <FilterChip href="/review" label="All" count={items.length} active={selectedCourseId === null} />
            {filters.map((course) => (
              <FilterChip
                key={course.id}
                href={`/review?course=${encodeURIComponent(course.id)}`}
                label={course.name}
                count={course.count}
                active={selectedCourseId === course.id}
              />
            ))}
          </nav>

          <ul className="mt-3 flex flex-col gap-2">
            {shown.map((item) => {
              const deadline = formatDeadline(item.deadline, now, timeZone, timeFormat);
              const note = notes.get(item.assignmentId) ?? null;

              return (
                <li
                  key={item.assignmentId}
                  className="relative overflow-hidden rounded-sm bg-p3 py-3 pr-4 pl-5 shadow-lift-1"
                >
                  {/* Moss for handed in. The only other place this system uses
                      it is a tracked course, and it means the same thing both
                      times: this one is settled. */}
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px] bg-moss" />

                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-faint">
                        {item.courseName}
                      </span>
                    </span>

                    <span className="shrink-0 font-mono text-[12px] text-ink-soft tabular-nums">
                      {deadline.day}
                      {deadline.time === null ? null : ` ${deadline.time}`}
                    </span>

                    <PaperBadge tone="state" className="shrink-0">
                      {item.submissionState === 'RETURNED' ? 'Returned' : 'Handed in'}
                    </PaperBadge>
                  </div>

                  <NoteEditor
                    assignmentId={item.assignmentId}
                    initial={note?.body ?? null}
                    title={item.title}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function FilterChip({
  href,
  label,
  count,
  active,
}: {
  readonly href: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1.5 text-[12px]',
        'transition-[box-shadow,background-color] focus-visible:paper-focus',
        active
          ? 'bg-p3 font-semibold text-ink shadow-lift-1'
          : 'bg-p1 font-medium text-ink-soft shadow-lift-0 hover:text-ink',
      )}
    >
      <span className="max-w-[16ch] truncate">{label}</span>
      <span className="font-mono text-[11px] text-ink-faint tabular-nums">{count}</span>
    </Link>
  );
}
