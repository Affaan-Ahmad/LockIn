import Link from 'next/link';

import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { DeadlineGroups } from '@/features/dashboard/DeadlineGroups';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { loadDashboard, requireSessionUser } from '@/lib/queries';

/**
 * Everything ahead, in order.
 *
 * Today answers "what now?"; this answers "what is coming?". The difference is
 * scope, not data, so it reuses the same loader and the same grouping rather
 * than growing a second definition of what counts as upcoming.
 *
 * Overdue work is not repeated here. It is on Today, where it belongs, and
 * showing it twice would make a list of future work look like a backlog.
 */
export const dynamic = 'force-dynamic';

export default async function UpcomingPage() {
  const user = await requireSessionUser();
  const data = await loadDashboard(user.id);
  const now = new Date();

  return (
    <AppShell
      title="Upcoming"
      subtitle={
        data.upcoming.length === 0
          ? undefined
          : `${String(data.upcoming.length)} ${data.upcoming.length === 1 ? 'deadline' : 'deadlines'} ahead.`
      }
      reviewCount={data.reviewCount}
      headerAside={<SyncStatus freshness={data.freshness} />}
    >
      <SyncStatus freshness={data.freshness} variant="banner" />

      {data.upcoming.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title="Nothing due ahead"
          body={
            data.overdue.length > 0
              ? 'No future deadlines. You do have overdue work on Today.'
              : 'No future deadlines in your tracked courses. New coursework appears here after a sync.'
          }
          action={
            <Link href={data.overdue.length > 0 ? '/' : '/courses'}>
              <Button variant="secondary">
                {data.overdue.length > 0 ? 'Go to Today' : 'Manage courses'}
              </Button>
            </Link>
          }
        />
      ) : (
        <DeadlineGroups items={data.upcoming} now={now} timeZone={data.freshness.timeZone} />
      )}
    </AppShell>
  );
}
