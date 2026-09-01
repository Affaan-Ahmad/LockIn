import { Badge } from '@/components/ui/Badge';
import { ExternalIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import type { formatDeadline } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

import { RELEVANCE, URGENCY, submissionPresentation } from './presentation';

/**
 * The pieces an assignment is made of.
 *
 * Extracted so the phone and the desktop can compose the same facts
 * differently without either restating what a deadline looks like. They must
 * never disagree about a value: both read the same `formatDeadline` output, and
 * the only thing that varies here is arrangement.
 *
 * Server Components, all of them. Nothing in this file needs the client.
 */

type Deadline = ReturnType<typeof formatDeadline>;

export function AssignmentTitle({
  item,
  className,
}: {
  readonly item: AssignmentView;
  readonly className?: string;
}) {
  const content =
    item.link === null ? (
      item.title
    ) : (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        // The whole row is not a link: that would make the title unselectable
        // and give a screen reader one enormous link.
        className="rounded-xs hover:text-brand"
      >
        {item.title}
        {/* Revealed on hover, and on focus so a keyboard user still learns the
            link leaves the site. */}
        <ExternalIcon
          className="ml-1.5 inline size-3.5 align-[-2px] text-ink-muted opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden="true"
        />
        <span className="sr-only"> (opens Google Classroom in a new tab)</span>
      </a>
    );

  return <h3 className={cx('font-medium text-balance text-ink', className)}>{content}</h3>;
}

export function CourseLabel({
  item,
  className,
}: {
  readonly item: AssignmentView;
  readonly className?: string;
}) {
  return <p className={cx('truncate text-ink-muted', className)}>{item.courseName}</p>;
}

/**
 * When it is due.
 *
 * The day carries the weight and the time trails it quieter: "Tomorrow" is what
 * a student navigates by, and 11:59 PM is the detail they read once they have
 * found the row. Colour is applied only to genuinely urgent bands, so red keeps
 * meaning something.
 */
export function DeadlineDisplay({
  deadline,
  className,
  showRelative = true,
}: {
  readonly deadline: Deadline;
  readonly className?: string;
  readonly showRelative?: boolean;
}) {
  const tone =
    deadline.band === 'overdue'
      ? 'text-danger'
      : deadline.band === 'today'
        ? 'text-warning'
        : 'text-ink';

  return (
    <span className={cx('min-w-0', className)}>
      <span className={cx('font-medium', tone)}>
        {deadline.machine === null ? (
          deadline.day
        ) : (
          <time dateTime={deadline.machine}>{deadline.day}</time>
        )}
      </span>
      {/* "No time given" rather than a borrowed 11:59 PM. Google gave a date and
          no time, and inventing one would fabricate the single most
          consequential value in the product. */}
      {deadline.time === null ? null : (
        <span className="ml-1.5 text-ink-soft">{deadline.time}</span>
      )}
      {showRelative && deadline.relative !== null ? (
        <span className="ml-1.5 text-ink-muted">{deadline.relative}</span>
      ) : null}
    </span>
  );
}

export function SubmissionStatus({ item }: { readonly item: AssignmentView }) {
  const submission = submissionPresentation(item.submissionState as never);
  if (!submission.show) return null;
  return <Badge tone={submission.tone}>{submission.label}</Badge>;
}

/**
 * Urgency and relevance chips.
 *
 * Only genuinely categorical state earns one. "Overdue" and "Due today"
 * qualify; anything further out does not, because a chip on every row is a chip
 * that means nothing.
 */
export function StatusChips({
  item,
  deadline,
}: {
  readonly item: AssignmentView;
  readonly deadline: Deadline;
}) {
  const urgency = URGENCY[deadline.band];
  const relevance = RELEVANCE[item.relevance];
  if (!urgency.show && !relevance.show) return null;

  return (
    <>
      {urgency.show ? <Badge tone={urgency.tone}>{urgency.label}</Badge> : null}
      {relevance.show ? <Badge tone={relevance.tone}>{relevance.label}</Badge> : null}
    </>
  );
}

/**
 * Why LockIn is unsure.
 *
 * Review screens only. It states what the classifier actually found, so a
 * student can judge it rather than being asked to trust an invisible rule.
 */
export function ScopeExplanation({ item }: { readonly item: AssignmentView }) {
  const sections = item.scopeSections.map((s) => s.toUpperCase()).join(', ');

  const explanation =
    item.scopeType === 'SPECIFIC_SECTIONS'
      ? `Looks like it is for section ${sections}.`
      : item.scopeType === 'ALL_SECTIONS_EXCEPT'
        ? `Looks like it is for everyone except section ${sections}.`
        : item.scopeType === 'ALL_SECTIONS'
          ? 'No section was mentioned, so this looks like it is for everyone.'
          : 'The post mentions sections, but not clearly enough to be sure.';

  return <p className="text-sm text-ink-soft">{explanation}</p>;
}
