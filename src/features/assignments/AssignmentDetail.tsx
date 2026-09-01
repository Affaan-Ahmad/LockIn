import Link from 'next/link';

import { CloseIcon, ExternalIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { formatDeadline } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

import { ScopeExplanation, StatusChips, SubmissionStatus } from './primitives';

/**
 * One assignment in full, in the desktop rail.
 *
 * Driven by a search parameter rather than client state, which is what keeps it
 * a Server Component. Selecting a row is a navigation: the back button closes
 * the panel, the URL can be shared, and the list does not become a client tree
 * to hold a single id. The alternative -- a dialog per row -- would have meant
 * fifty client islands on the busiest screen in the product.
 *
 * It occupies the rail rather than covering the page. A modal over a list is a
 * phone pattern; on a desktop there is room to read the detail and keep the
 * list it came from in view, which is the whole reason a rail exists.
 *
 * Nothing here is fetched. Every field is already in the row the list rendered,
 * so opening the panel costs no round trip.
 */

export interface AssignmentDetailProps {
  readonly item: AssignmentView;
  readonly now: Date;
  readonly timeZone: string;
  /** Where the close control returns to. The current route, without the param. */
  readonly closeHref: string;
}

export function AssignmentDetail({ item, now, timeZone, closeHref }: AssignmentDetailProps) {
  const deadline = formatDeadline(item.deadline, now, timeZone);

  return (
    <section
      aria-label={`Details for ${item.title}`}
      className="surface-flat sticky top-20 flex flex-col gap-4 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{item.courseName}</p>
          <h2 className="mt-1 text-base font-medium text-balance text-ink">{item.title}</h2>
        </div>
        <Link
          href={closeHref}
          // Replaces rather than pushes: closing a panel should not put a step
          // between the student and wherever they were before they opened it.
          replace
          scroll={false}
          aria-label="Close details"
          className="press -mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <CloseIcon className="size-4" />
        </Link>
      </div>

      <dl className="flex flex-col gap-2.5 text-sm">
        <Field label="Due">
          <span className="font-medium text-ink">{deadline.day}</span>
          {deadline.time === null ? (
            // Said plainly rather than left blank. Google gave a date and no
            // time, and the student needs to know that is the source's answer
            // and not a rendering gap.
            <span className="ml-1.5 text-ink-muted">No time given</span>
          ) : (
            <span className="ml-1.5 text-ink-soft">{deadline.time}</span>
          )}
          {deadline.relative === null ? null : (
            <span className="ml-1.5 text-ink-muted">{deadline.relative}</span>
          )}
        </Field>

        <Field label="Status">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusChips item={item} deadline={deadline} />
            <SubmissionStatus item={item} />
            {item.hasManualOverride ? (
              <span className="text-xs text-ink-muted">Your choice</span>
            ) : null}
          </span>
        </Field>

        <Field label="Why you can see this">
          <ScopeExplanation item={item} />
        </Field>
      </dl>

      {item.link === null ? null : (
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="block">
          <Button variant="secondary" size="sm" fullWidth>
            <ExternalIcon className="size-3.5" aria-hidden="true" />
            Open in Classroom
          </Button>
        </a>
      )}
    </section>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
