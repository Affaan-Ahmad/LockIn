import { AssignmentCard } from '@/features/assignments/AssignmentCard';
import { IgnoreButton } from '@/features/assignments/IgnoreButton';
import { GROUP_LABEL, GROUP_ORDER } from '@/features/assignments/presentation';
import { urgencyBand, type UrgencyBand } from '@/lib/format';
import type { AssignmentView } from '@/lib/queries';

/**
 * Assignments grouped by when they are due.
 *
 * Grouping happens here rather than in the query because it is presentation:
 * "Tomorrow" is a heading, not a database concept, and the band depends on the
 * student's timezone and the current moment.
 *
 * Empty groups are never rendered. A page listing "Tomorrow — nothing",
 * "This week — nothing" is noise dressed as structure.
 */

export interface DeadlineGroupsProps {
  readonly items: readonly AssignmentView[];
  readonly now: Date;
  readonly timeZone: string;
  /**
   * Offer a hide control on overdue items only.
   *
   * Deliberately not offered on future work. Hiding something that has not
   * happened yet is how a student loses a deadline they still have time to
   * meet; hiding something already missed and dealt with is housekeeping.
   */
  readonly allowHideOverdue?: boolean;
}

export function DeadlineGroups({
  items,
  now,
  timeZone,
  allowHideOverdue = false,
}: DeadlineGroupsProps) {
  const grouped = new Map<UrgencyBand, AssignmentView[]>();

  for (const item of items) {
    const band = urgencyBand(item.deadline, now, timeZone);
    const bucket = grouped.get(band);
    if (bucket === undefined) grouped.set(band, [item]);
    else bucket.push(item);
  }

  return (
    <div className="flex flex-col gap-7">
      {GROUP_ORDER.map((band) => {
        const group = grouped.get(band);
        if (group === undefined || group.length === 0) return null;

        return (
          <section key={band} aria-labelledby={`group-${band}`}>
            {/* A heading, not an eyebrow. Uppercase wide-tracking micro-caps
                above every group is the single most templated rhythm in
                generated interfaces, and with five bands it repeats five
                times on one screen. Weight and colour carry the hierarchy
                instead, and the count sits in a quieter tone beside it. */}
            <h2
              id={`group-${band}`}
              className="mb-2.5 flex items-baseline gap-2 px-1 text-[0.9375rem] font-bold tracking-[-0.01em] text-ink"
            >
              {GROUP_LABEL[band]}
              <span className="text-[0.8125rem] font-semibold text-ink-muted">{group.length}</span>
            </h2>
            <ul className="flex flex-col gap-2.5">
              {group.map((item) => (
                <li key={item.assignmentId}>
                  <AssignmentCard
                    item={item}
                    now={now}
                    timeZone={timeZone}
                    actions={
                      allowHideOverdue && band === 'overdue' ? (
                        <IgnoreButton
                          assignmentId={item.assignmentId}
                          ignored={false}
                          title={item.title}
                        />
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
