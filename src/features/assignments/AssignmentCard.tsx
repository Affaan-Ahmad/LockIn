import type { ReactNode } from 'react';
import Link from 'next/link';

import { formatDeadline } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';
import {
  AssignmentTitle, CourseLabel, DeadlineDisplay, ScopeExplanation, StatusChips, SubmissionStatus,
} from './primitives';

export interface AssignmentCardProps {
  readonly item: AssignmentView;
  readonly now: Date;
  readonly timeZone: string;
  readonly showScope?: boolean;
  readonly actions?: ReactNode;
  readonly detailHref?: string;
  readonly selected?: boolean;
}

/** Shared facts render once. Named CSS areas compose the phone card and web row. */
export function AssignmentCard({
  item, now, timeZone, showScope = false, actions, detailHref, selected = false,
}: AssignmentCardProps) {
  const deadline = formatDeadline(item.deadline, now, timeZone);
  return (
    <article className="assignment-item" data-selected={selected || undefined} data-urgency={deadline.band}>
      <div className="assignment-identity">
        <AssignmentTitle item={item} className="assignment-title" />
        <CourseLabel item={item} className="assignment-course" />
      </div>
      <div className="assignment-deadline">
        <DeadlineDisplay deadline={deadline} className="deadline-value" />
      </div>
      <div className="assignment-status">
        <StatusChips item={item} deadline={deadline} />
        <SubmissionStatus item={item} />
        {item.hasManualOverride ? <span className="text-xs text-ink-muted">Your choice</span> : null}
      </div>
      {detailHref === undefined && actions === undefined ? null : (
        <div className="assignment-actions">
          {actions}
          {detailHref === undefined ? null : (
            <Link
              href={detailHref}
              aria-label={`Details for ${item.title}`}
              aria-current={selected ? 'true' : undefined}
              className="assignment-detail-link"
            >Details</Link>
          )}
        </div>
      )}
      {showScope ? <div className="assignment-scope"><ScopeExplanation item={item} /></div> : null}
    </article>
  );
}
