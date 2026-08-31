import Link from 'next/link';

import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AssignmentCard } from '@/features/assignments/AssignmentCard';
import { IgnoreButton } from '@/features/assignments/IgnoreButton';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { loadDashboard, loadIgnored, requireSessionUser } from '@/lib/queries';

/**
 * Work the student chose to hide.
 *
 * A real screen rather than a settings toggle, because hiding is only safe if
 * it is reversible and visible. Anything that disappears with no way back stops
 * being a filter and becomes data loss the student performed on themselves.
 *
 * Nothing here is filtered by relevance or by age: whatever was hidden is
 * listed, exactly as it was, with one button to bring it back.
 */
export const dynamic = 'force-dynamic';

export default async function IgnoredPage() {
  const user = await requireSessionUser();
  const [{ items, freshness }, dashboard] = await Promise.all([
    loadIgnored(user.id),
    loadDashboard(user.id),
  ]);

  const now = new Date();

  // Spread rather than `subtitle={... : undefined}`: exactOptionalPropertyTypes
  // treats an explicit undefined as a value, not an omission.
  const subtitle =
    items.length === 0
      ? {}
      : {
          subtitle: `${String(items.length)} ${items.length === 1 ? 'item is' : 'items are'} hidden from your lists.`,
        };

  return (
    <AppShell
      title="Hidden"
      {...subtitle}
      reviewCount={dashboard.reviewCount}
      headerAside={<SyncStatus freshness={freshness} />}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title="Nothing is hidden"
          body="Overdue work you have already dealt with can be hidden from Today. It will always be listed here, and you can bring it back at any time."
          action={
            <Link href="/">
              <Button variant="secondary">Back to Today</Button>
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={item.assignmentId}>
              <AssignmentCard
                item={item}
                now={now}
                timeZone={freshness.timeZone}
                actions={
                  <IgnoreButton assignmentId={item.assignmentId} ignored title={item.title} />
                }
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 px-1 text-[0.8125rem] text-ink-soft">
        Hiding is only about what you see. It does not tell LockIn the work was for someone
        else, and it does not mark anything as done in Google Classroom.
      </p>
    </AppShell>
  );
}
