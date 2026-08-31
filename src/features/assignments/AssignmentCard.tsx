import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { ExternalIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { formatDeadline } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

import { RELEVANCE, URGENCY, submissionPresentation } from './presentation';

/**
 * One assignment.
 *
 * A Server Component, and deliberately a flat one: no per-card state and no
 * client boundary. That keeps a list of fifty cheap to render and leaves the
 * door open to virtualisation later without rewriting anything.
 *
 * Two zones, not one. The face carries what the student is looking for: the
 * title, and under it the course it came from. The well beneath carries
 * everything else -- when it is due, whether it is handed in, and any control
 * that acts on it.
 *
 * That split is the point of the composition. Previously the deadline, the
 * relative time, the submission badge, the override note and the action button
 * shared a single wrapping row at one size, so a card read as five unrelated
 * facts; and the urgency chip sat in the opposite corner from the deadline it
 * described. Recessing the metadata makes it one object with a rank inside it.
 *
 * What it shows is decided by the presentation map, not by conditionals here.
 * A new status is an entry in that map; this component does not change.
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
}

export function AssignmentCard({
  item,
  now,
  timeZone,
  showScope = false,
  actions,
}: AssignmentCardProps) {
  const deadline = formatDeadline(item.deadline, now, timeZone);
  const urgency = URGENCY[deadline.band];
  const relevance = RELEVANCE[item.relevance];
  const submission = submissionPresentation(item.submissionState as never);

  const dayTone =
    deadline.band === 'overdue'
      ? 'text-danger'
      : deadline.band === 'today'
        ? 'text-warning'
        : 'text-ink';

  return (
    <article className="clay lift group relative overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          {/* Medium, not semibold. The title is already the largest thing on
              the card, which is enough to make it first; weight on top of that
              made it compete with the deadline rather than lead it. */}
          <h3 className="text-lg font-medium text-balance text-ink">
            {item.link === null ? (
              item.title
            ) : (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                // The whole card is not a link: that would make the title
                // unselectable and give a screen reader one enormous link.
                className="rounded-xs hover:text-brand "
              >
                {item.title}
                {/* Revealed on hover. A permanent glyph on every title is a
                    row of arrows down the page pointing at nothing in
                    particular; on focus it must still appear, or a keyboard
                    user never learns the link leaves the site. */}
                <ExternalIcon
                  className="ml-1.5 inline size-3.5 align-[-2px] text-ink-muted opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-hidden="true"
                />
                <span className="sr-only"> (opens Google Classroom in a new tab)</span>
              </a>
            )}
          </h3>
          <p className="mt-1 truncate text-sm text-ink-muted">{item.courseName}</p>
        </div>

        {/* Only genuinely categorical states get a chip. "Overdue" and "Due
            today" qualify; anything further out does not, because a chip on
            every card is a chip that means nothing. */}
        {urgency.show || relevance.show ? (
          <div className="flex shrink-0 flex-col items-end gap-2">
            {urgency.show ? <Badge tone={urgency.tone}>{urgency.label}</Badge> : null}
            {relevance.show ? <Badge tone={relevance.tone}>{relevance.label}</Badge> : null}
          </div>
        ) : null}
      </div>

      {showScope ? <ScopeLine item={item} /> : null}

      <div className="well flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <span className="min-w-0 text-sm">
          {/* The day carries the weight and the time trails it, quieter.
              "Tomorrow" is what a student navigates by; 11:59 PM is the detail
              they read once they have found the row. */}
          <span className={cx('font-medium', dayTone)}>
            {deadline.machine === null ? (
              deadline.day
            ) : (
              <time dateTime={deadline.machine}>{deadline.day}</time>
            )}
          </span>
          {/* "No time given" rather than a borrowed 11:59 PM. Google gave a date
              and no time, and inventing one would fabricate the single most
              consequential value in the product. */}
          {deadline.time === null ? null : (
            <span className="ml-1.5 text-ink-soft">{deadline.time}</span>
          )}
          {deadline.relative === null ? null : (
            <span className="ml-1.5 text-ink-muted">{deadline.relative}</span>
          )}
        </span>

        {submission.show ? <Badge tone={submission.tone}>{submission.label}</Badge> : null}

        {item.hasManualOverride ? (
          <span className="text-xs text-ink-muted">Your choice</span>
        ) : null}

        {actions === undefined ? null : <span className="ml-auto">{actions}</span>}
      </div>
    </article>
  );
}

/**
 * Why LockIn is unsure.
 *
 * Shown only on the review screen, and on the card face rather than in the
 * well: it is the reason the student is being asked something, so it belongs
 * with the question rather than with the metadata.
 */
function ScopeLine({ item }: { readonly item: AssignmentView }) {
  const sections = item.scopeSections.map((s) => s.toUpperCase()).join(', ');

  const explanation =
    item.scopeType === 'SPECIFIC_SECTIONS'
      ? `Looks like it is for section ${sections}.`
      : item.scopeType === 'ALL_SECTIONS_EXCEPT'
        ? `Looks like it is for everyone except section ${sections}.`
        : item.scopeType === 'ALL_SECTIONS'
          ? 'No section was mentioned, so this looks like it is for everyone.'
          : 'The post mentions sections, but not clearly enough to be sure.';

  return <p className="px-4 pb-3 text-sm text-ink-soft">{explanation}</p>;
}
