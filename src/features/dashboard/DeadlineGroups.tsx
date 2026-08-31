import { AssignmentCard } from '@/features/assignments/AssignmentCard';
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
}

export function DeadlineGroups({ items, now, timeZone }: DeadlineGroupsProps) {
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
            <h2
              id={`group-${band}`}
              className="mb-2.5 px-1 text-[0.75rem] font-bold tracking-[0.06em] text-ink-muted uppercase"
            >
              {GROUP_LABEL[band]}
              <span className="ml-2 font-semibold normal-case">{group.length}</span>
            </h2>
            <ul className="flex flex-col gap-2.5">
              {group.map((item) => (
                <li key={item.assignmentId}>
                  <AssignmentCard item={item} now={now} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
