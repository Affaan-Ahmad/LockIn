import { Badge } from '@/components/ui/Badge';
import { ClockIcon, ExternalIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { formatDeadline } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

import { RELEVANCE, URGENCY, submissionPresentation } from './presentation';

/**
 * One assignment.
 *
 * A Server Component, and deliberately a flat one: a heading, a course line, a
 * time, and at most two badges. No nested animated wrappers, no per-card state,
 * no client boundary. That keeps a list of fifty cards cheap to render and
 * leaves the door open to virtualisation later without rewriting anything.
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
}

export function AssignmentCard({ item, now, timeZone, showScope = false }: AssignmentCardProps) {
  const deadline = formatDeadline(item.deadline, now, timeZone);
  const urgency = URGENCY[deadline.band];
  const relevance = RELEVANCE[item.relevance];
  const submission = submissionPresentation(item.submissionState as never);

  const overdue = deadline.band === 'overdue';

  return (
    <article
      className={cx(
        'clay lift group relative p-4 active:translate-y-px hover:-translate-y-px',
        // A left edge rather than a full red card. Turning the whole surface
        // red destroys the meaning of red once three things are overdue.
        overdue ? 'border-l-[3px] border-l-danger' : '',
        deadline.band === 'today' && !overdue ? 'border-l-[3px] border-l-warning' : '',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[1.0625rem] leading-snug font-semibold text-balance text-ink">
            {item.link === null ? (
              item.title
            ) : (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                // The whole card is not a link: that would make the title
                // unselectable and give a screen reader one enormous link.
                className="hover:text-brand focus-visible:text-brand"
              >
                {item.title}
                <ExternalIcon className="ml-1.5 inline size-3.5 align-[-2px] text-ink-muted" />
                <span className="sr-only"> (opens Google Classroom in a new tab)</span>
              </a>
            )}
          </h3>
          <p className="mt-0.5 truncate text-[0.8125rem] text-ink-soft">{item.courseName}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {urgency.show ? (
            <Badge tone={urgency.tone} dot>
              {urgency.label}
            </Badge>
          ) : null}
          {relevance.show ? <Badge tone={relevance.tone}>{relevance.label}</Badge> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem]">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 font-semibold',
            overdue ? 'text-danger' : deadline.band === 'today' ? 'text-warning' : 'text-ink',
          )}
        >
          <ClockIcon className="size-4" aria-hidden="true" />
          {deadline.machine === null ? (
            <span>{deadline.day}</span>
          ) : (
            <time dateTime={deadline.machine}>
              {deadline.day}
              {/* "No time given" rather than a borrowed 11:59 PM. Google gave a
                  date and no time, and inventing one would fabricate the single
                  most consequential value in the product. */}
              {deadline.time === null ? '' : ` · ${deadline.time}`}
            </time>
          )}
        </span>

        {deadline.relative === null ? null : (
          <span className="text-ink-muted">{deadline.relative}</span>
        )}

        {submission.show ? <Badge tone={submission.tone}>{submission.label}</Badge> : null}

        {item.hasManualOverride ? (
          <span className="text-[0.75rem] text-ink-muted">Your choice</span>
        ) : null}
      </div>

      {showScope ? <ScopeLine item={item} /> : null}
    </article>
  );
}

/**
 * Why LockIn is unsure.
 *
 * Shown only on the review screen. It states what the backend actually found,
 * so the student can judge for themselves rather than being asked to trust an
 * invisible rule.
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

  return (
    <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-ink-soft">{explanation}</p>
  );
}
