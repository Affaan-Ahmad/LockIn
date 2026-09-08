import Link from 'next/link';

import { ChevronRightIcon } from '@/components/icons';
import {
  Annotation,
  Caption,
  ContourCard,
  LayeredCard,
  PaperBadge,
  PaperButtonLink,
  RecessedWell,
} from '@/components/paper';
import type { TimeFormat } from '@/lib/clock';
import { cx } from '@/lib/cx';
import { formatDeadline } from '@/lib/format';
import type { AssignmentView, CourseView } from '@/lib/queries';

/**
 * Today, as paper.
 *
 * The screen is ordered by what a student can still do something about: what is
 * already late, what is due before the day ends, and what is coming. Each band
 * is a different material rather than a different colour — late is a card of
 * its own with a red top edge, today is a stack of raised rows, this week is a
 * single recessed table — so the hierarchy survives greyscale and forced
 * colours, where every tint would collapse to the same grey.
 *
 * Red means late and nothing else in this system is red.
 */

export interface PaperTodayProps {
  readonly now: Date;
  readonly timeZone: string;
  readonly timeFormat: TimeFormat;
}

const detailHref = (id: string): string =>
  `/?assignment=${encodeURIComponent(id)}#assignment-details`;

function stateLabel(item: AssignmentView): string {
  if (item.submissionState === 'TURNED_IN' || item.submissionState === 'RETURNED') {
    return 'Submitted';
  }
  return item.submissionState === 'CREATED' ? 'Draft saved' : 'Not submitted';
}

/** `Course C · Section 02`, with the section omitted when there is not one. */
function courseLine(item: AssignmentView): string {
  const section = item.scopeSections[0];
  return section === undefined ? item.courseName : `${item.courseName} · Section ${section}`;
}

export function LateCard({
  items,
  now,
  timeZone,
  timeFormat,
}: PaperTodayProps & { readonly items: readonly AssignmentView[] }) {
  const first = items[0];
  if (first === undefined) return null;
  const deadline = formatDeadline(first.deadline, now, timeZone, timeFormat);

  return (
    <section aria-labelledby="late-heading">
      <LayeredCard lift={2} status="terra" statusEdge="top" className="hidden lg:block">
        <LateBody item={first} deadline={deadline} count={items.length} />
      </LayeredCard>
      {/* On a phone the bar runs down the left instead: a 4px strip across the
          top of a full-width card reads as a border, not as a marker. */}
      <LayeredCard lift={2} status="terra" statusEdge="left" className="lg:hidden">
        <LateBody item={first} deadline={deadline} count={items.length} />
      </LayeredCard>
    </section>
  );
}

function LateBody({
  item,
  deadline,
  count,
}: {
  readonly item: AssignmentView;
  readonly deadline: ReturnType<typeof formatDeadline>;
  readonly count: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 pl-5 lg:px-5">
      {/* Full width until there is room for a single row. The deadline, the
          state and the button are all intrinsically sized, so left as a flex
          child on a phone the title shrinks past its longest word. */}
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        <div className="flex items-center gap-2">
          <Caption className="text-terra">Late</Caption>
          {count > 1 ? <Caption>{count}</Caption> : null}
        </div>
        <h2 id="late-heading" className="mt-1 text-[14.5px] font-semibold tracking-[-0.012em] text-ink">
          {item.title}
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-soft">{courseLine(item)}</p>
      </div>

      <p className="font-mono text-[13.5px] font-medium text-terra tabular-nums">
        {deadline.relative ?? deadline.day}
        {deadline.time === null ? null : (
          <span className="ml-2 text-ink-faint">was {deadline.time}</span>
        )}
      </p>

      <p className="text-[12.5px] text-ink-soft">{stateLabel(item)}</p>

      <PaperButtonLink href={detailHref(item.assignmentId)} variant="secondary" size="sm">
        Open
      </PaperButtonLink>
    </div>
  );
}

export function DueTodaySection({
  items,
  now,
  timeZone,
  timeFormat,
}: PaperTodayProps & { readonly items: readonly AssignmentView[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="due-today-heading" className="mt-7">
      <SectionRule id="due-today-heading" label="Due today" count={items.length} />
      <ul className="mt-3 flex flex-col gap-2.5">
        {items.map((item) => {
          const deadline = formatDeadline(item.deadline, now, timeZone, timeFormat);
          return (
            <li key={item.assignmentId}>
              <LayeredCard lift={2} status="glow-deep" interactive>
                <Link
                  href={detailHref(item.assignmentId)}
                  className="flex min-h-[66px] items-center gap-4 py-3 pr-3 pl-5 focus-visible:paper-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold tracking-[-0.012em] text-ink">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
                      {courseLine(item)}
                    </span>
                  </span>

                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block font-mono text-[13.5px] font-medium text-ink tabular-nums">
                      {deadline.time ?? deadline.day}
                    </span>
                    {deadline.relative === null ? null : (
                      <span className="block font-mono text-[11.5px] text-ink-faint tabular-nums">
                        {deadline.relative}
                      </span>
                    )}
                  </span>

                  <PaperBadge className="hidden shrink-0 md:inline-flex">
                    {stateLabel(item)}
                  </PaperBadge>
                  <ChevronRightIcon className="size-4 shrink-0 text-ink-faint" />
                </Link>
              </LayeredCard>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ThisWeekTable({
  items,
  now,
  timeZone,
  timeFormat,
}: PaperTodayProps & { readonly items: readonly AssignmentView[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="this-week-heading" className="mt-7">
      <SectionRule id="this-week-heading" label="This week" count={items.length} />
      {/* One recessed table rather than more cards. Everything here is far
          enough away that giving each row its own sheet would flatten the
          distinction with what is due today. */}
      <RecessedWell className="mt-3 overflow-hidden">
        <ul className="divide-y divide-edge-soft">
          {items.map((item) => {
            const deadline = formatDeadline(item.deadline, now, timeZone, timeFormat);
            return (
              <li key={item.assignmentId}>
                <Link
                  href={detailHref(item.assignmentId)}
                  className="flex min-h-[54px] items-center gap-4 px-4 transition-colors hover:bg-p2 focus-visible:paper-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {item.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-faint">
                      {item.courseName}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12.5px] text-ink-soft tabular-nums">
                    {deadline.day}
                    {deadline.time === null ? null : ` ${deadline.time}`}
                  </span>
                  <span className="hidden shrink-0 text-[12px] text-ink-faint sm:block">
                    {stateLabel(item)}
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-ink-faint" />
                </Link>
              </li>
            );
          })}
        </ul>
      </RecessedWell>
    </section>
  );
}

function SectionRule({
  id,
  label,
  count,
}: {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <Caption>
        <span id={id}>{label}</span>
      </Caption>
      <span aria-hidden="true" className="h-px flex-1 bg-edge-soft" />
      <span className="font-mono text-[11.5px] text-ink-faint tabular-nums">{count}</span>
    </div>
  );
}

export function NeedsReviewCard({
  item,
  remaining,
}: {
  readonly item: AssignmentView | undefined;
  readonly remaining: number;
}) {
  if (item === undefined) return null;

  // Three plain-language lines, never a confidence number. A percentage invites
  // a student to argue with the classifier instead of answering the question.
  const evidence: readonly string[] = [
    item.scopeSections.length > 0
      ? `Title mentions Section ${item.scopeSections.join(', ')}`
      : 'No section named in the title or description',
    item.scopeType === 'ALL_SECTIONS'
      ? 'Posted to everyone, no section tag'
      : 'Posted with a section restriction',
    item.hasManualOverride ? 'You have decided on this before' : 'You have not decided on this yet',
  ];

  return (
    <section aria-labelledby="review-heading" className="relative">
      <ContourCard glow>
        <div className="p-4 lg:p-5">
          <div className="flex items-center justify-between gap-3">
            <Caption className="text-slate">
              <span id="review-heading">Needs review</span>
            </Caption>
            <span className="font-mono text-[11.5px] text-ink-faint tabular-nums">
              1 of {remaining}
            </span>
          </div>

          <h2 className="mt-2 text-[16px] font-bold tracking-[-0.02em] text-ink">{item.title}</h2>
          <p className="mt-1 text-[12px] text-ink-soft">{item.courseName}</p>

          <RecessedWell tone="p1" className="mt-3 p-3">
            <ul className="flex flex-col gap-1.5">
              {evidence.map((line) => (
                <li key={line} className="text-[12.5px] leading-snug text-ink-soft">
                  {line}
                </li>
              ))}
            </ul>
          </RecessedWell>

          <div className="mt-4 flex flex-wrap gap-2">
            <PaperButtonLink href="/review" variant="primary" size="md" className="flex-1">
              This is for me
            </PaperButtonLink>
            <PaperButtonLink href="/review" variant="secondary" size="md" className="flex-1">
              Not for me
            </PaperButtonLink>
          </div>
        </div>
      </ContourCard>
      <Annotation rotate={-4} className="absolute -top-3 right-2 z-10">
        your call
      </Annotation>
    </section>
  );
}

export function TrackedCard({
  courses,
  staleNote,
}: {
  readonly courses: readonly CourseView[];
  readonly staleNote: string | null;
}) {
  const tracked = courses.filter((course) => course.isTracked).slice(0, 6);
  if (tracked.length === 0) return null;

  return (
    <section aria-labelledby="tracked-heading" className="mt-5">
      <LayeredCard lift={1}>
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <Caption>
              <span id="tracked-heading">Tracked</span>
            </Caption>
            <Link
              href="/courses"
              className="text-[12px] font-medium text-kraft-3 hover:underline focus-visible:paper-focus"
            >
              Manage
            </Link>
          </div>

          <ul className="mt-3 flex flex-col gap-1.5">
            {tracked.map((course) => (
              <li
                key={course.courseId}
                className="relative flex items-center gap-3 rounded-xs bg-p1 py-2 pr-3 pl-3.5 shadow-lift-0"
              >
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-moss" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{course.name}</span>
                {course.section === null ? null : (
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                    Sec {course.section}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {staleNote === null ? null : (
            <RecessedWell tone="p1" className="mt-3 p-3">
              <p className={cx('text-[12.5px] leading-snug text-ink-soft')}>{staleNote}</p>
            </RecessedWell>
          )}
        </div>
      </LayeredCard>
    </section>
  );
}
