import type { ReactNode } from 'react';
import Link from 'next/link';

import { formatDeadline } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

import {
  AssignmentTitle,
  CourseLabel,
  DeadlineDisplay,
  ScopeExplanation,
  StatusChips,
  SubmissionStatus,
} from './primitives';

/**
 * One assignment, composed for whichever shell it lands in.
 *
 * A single DOM tree that reflows, not two trees with one hidden. That choice is
 * specific to this component and it is about cardinality: there is one
 * navigation per page, so CSS-hiding a duplicate costs nothing, but a term's
 * coursework is fifty of these, and shipping a phone card and a desktop row for
 * every one would double the markup on the busiest screen in the product.
 *
 * The two compositions are genuinely different, not one padded out:
 *
 *   Touch     A card. Title leads, course beneath it, everything else recessed
 *             into a well at the foot. Vertical and tactile.
 *
 *   Pointer   A row. Course, title, deadline and status share one baseline
 *             across a twelve-column grid, so roughly twice as many fit on a
 *             screen. The well flattens into an inline group and the clay depth
 *             drops to a hairline that lifts only on hover, so elevation marks
 *             the row under the cursor rather than every row at once.
 *
 * The switch is `data-density`, set by the web shell, not a raw breakpoint. A
 * card rendered inside the mobile shell stays a card at any width, which is
 * what makes the mobile experience testable in a desktop browser.
 */

export interface AssignmentCardProps {
  readonly item: AssignmentView;
  readonly now: Date;
  readonly timeZone: string;
  /** Review cards explain the scope; the normal feed does not need to. */
  readonly showScope?: boolean;
  /**
   * Client islands the card hosts but does not own -- the hide control, the
   * relevance choice. Passed in so the card itself stays a Server Component
   * regardless of what interactive controls a screen decides to attach.
   */
  readonly actions?: ReactNode;
  /**
   * Turns the pointer row into a detail trigger. A plain link to a search
   * parameter, so selecting a row stays a navigation the back button
   * understands and the list never needs client state to remember which one is
   * open. Omitted on touch, where the panel has nowhere to sit and Classroom is
   * the better destination anyway.
   */
  readonly detailHref?: string;
  readonly selected?: boolean;
}

export function AssignmentCard({
  item,
  now,
  timeZone,
  showScope = false,
  actions,
  detailHref,
  selected = false,
}: AssignmentCardProps) {
  const deadline = formatDeadline(item.deadline, now, timeZone);

  return (
    <article
      className={[
        'group relative overflow-hidden clay lift',
        'in-data-[density=pointer]:rounded-control',
        'in-data-[density=pointer]:shadow-none',
        'in-data-[density=pointer]:hover:shadow-raised',
        selected ? 'in-data-[density=pointer]:ring-1 in-data-[density=pointer]:ring-brand-ink' : '',
      ].join(' ')}
    >
      {/* Touch composition */}
      <div className="in-data-[density=pointer]:hidden">
        <div className="flex items-start justify-between gap-3 p-4 pb-3">
          <div className="min-w-0 flex-1">
            <AssignmentTitle item={item} className="text-lg" />
            <CourseLabel item={item} className="mt-1 text-sm" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusChips item={item} deadline={deadline} />
          </div>
        </div>

        {showScope ? (
          <div className="px-4 pb-3">
            <ScopeExplanation item={item} />
          </div>
        ) : null}

        <div className="well flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <DeadlineDisplay deadline={deadline} className="text-sm" />
          <SubmissionStatus item={item} />
          {item.hasManualOverride ? (
            <span className="text-xs text-ink-muted">Your choice</span>
          ) : null}
          {actions === undefined ? null : <span className="ml-auto">{actions}</span>}
        </div>
      </div>

      {/* Pointer composition */}
      <div className="hidden in-data-[density=pointer]:block">
        {detailHref === undefined ? null : (
          <Link
            href={detailHref}
            scroll={false}
            aria-label={`Show details for ${item.title}`}
            // Covers the row beneath the content, so the whole row is
            // clickable without wrapping the title link inside another link,
            // which is invalid and gives a screen reader one enormous target.
            className="absolute inset-0 z-0"
          />
        )}
        <div className="pointer-events-none relative z-10 grid grid-cols-12 items-center gap-x-4 px-3.5 py-2.5 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          {/* Course leads on desktop. On a phone it is context read after the
              title; in a scanned column it is what the eye groups by. */}
          <CourseLabel item={item} className="col-span-3 text-xs" />
          <AssignmentTitle item={item} className="col-span-4 min-w-0 truncate text-sm" />
          <DeadlineDisplay
            deadline={deadline}
            className="col-span-3 text-sm"
            // Redundant beside an absolute time in a dense row, and the first
            // thing to cost a truncation.
            showRelative={false}
          />
          <div className="col-span-2 flex items-center justify-end gap-2">
            <StatusChips item={item} deadline={deadline} />
            <SubmissionStatus item={item} />
            {actions}
          </div>
        </div>

        {showScope ? (
          <div className="border-t border-line px-3.5 py-2.5">
            <ScopeExplanation item={item} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
