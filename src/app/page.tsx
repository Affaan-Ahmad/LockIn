import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { DeadlineGroups } from '@/features/dashboard/DeadlineGroups';
import { WorkloadHeader } from '@/features/dashboard/WorkloadHeader';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { urgencyBand } from '@/lib/format';
import { loadDashboard, loadSetupState, requireSessionUser } from '@/lib/queries';
import { redirect } from 'next/navigation';
import Link from 'next/link';

/**
 * Today. The screen the product exists for.
 *
 * A Server Component with no client boundary at all: the whole dashboard is
 * HTML by the time it reaches the browser, and the only JavaScript on the page
 * is the navigation island.
 *
 * Deadlines are freshness-sensitive, so this is never cached. A cached
 * dashboard would show yesterday's coursework as today's, which is the exact
 * failure the product is built to prevent.
 */
export const dynamic = 'force-dynamic';

function SecondaryLink({
  href,
  label,
  hint,
}: {
  readonly href: string;
  readonly label: string;
  readonly hint?: string;
}) {
  return (
    <Link
      href={href}
      className="press group flex items-center justify-between gap-3 rounded-control px-1 py-3.5 hover:bg-sunken "
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint === undefined ? null : (
          <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 text-ink-muted transition-transform duration-[120ms] group-hover:translate-x-0.5"
      >
        &rarr;
      </span>
    </Link>
  );
}

export default async function TodayPage() {
  const user = await requireSessionUser();

  // Started together, not one after the other. Every Supabase call is a round
  // trip to another region, so awaiting the setup check before beginning the
  // dashboard added a full one to the screen a student opens most.
  //
  // A half-configured account does pay for a dashboard it will not see. That
  // happens at most a handful of times per account, against a cost paid on
  // every load thereafter.
  const setupPromise = loadSetupState(user.id);
  const dashboardPromise = loadDashboard(user.id);

  const setup = await setupPromise;

  // A half-configured account is sent to the step it is missing rather than
  // shown an empty dashboard it cannot explain.
  if (!setup.hasConnection || !setup.hasProfile) redirect('/welcome');
  if (!setup.hasTrackedCourses) redirect('/courses?setup=1');

  const data = await dashboardPromise;
  const now = new Date();
  const { timeZone } = data.freshness;

  const todayCount = data.upcoming.filter(
    (item) => urgencyBand(item.deadline, now, timeZone) === 'today',
    ).length;

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hour12: false }).format(now),
    );

  // Overdue first, deliberately. It is the most urgent thing a student has, and
  // burying it under future work is how it gets missed twice.
  const items = [...data.overdue, ...data.upcoming];

  return (
    <AppShell
      title="Today"
      reviewCount={data.reviewCount}
      headerAside={<SyncStatus freshness={data.freshness} />}
    >
      <SyncStatus freshness={data.freshness} variant="banner" />

      <WorkloadHeader
        hour={hour}
        overdueCount={data.overdue.length}
        todayCount={todayCount}
        upcomingCount={data.upcoming.length}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title="You're all caught up"
          body="Nothing is due right now. LockIn will show new coursework here after the next sync."
          action={
            <Link href="/courses">
              <Button variant="secondary">Manage courses</Button>
            </Link>
          }
        />
      ) : (
        <DeadlineGroups items={items} now={now} timeZone={timeZone} allowHideOverdue />
      )}

      {/* Secondary destinations, below the work and quieter than it. These
          were two clay panels competing with the assignment cards above; as
          rows on the ground they read as what they are, which is a way out of
          this screen rather than more of it. */}
      {data.reviewCount > 0 || data.ignoredCount > 0 ? (
        <div className="mt-8 flex flex-col divide-y divide-line border-t border-line">
          {data.reviewCount > 0 ? (
            <SecondaryLink
              href="/review"
              label={`${String(data.reviewCount)} ${data.reviewCount === 1 ? 'item needs' : 'items need'} a decision`}
              hint="LockIn wasn't sure whether these are for your section."
            />
          ) : null}
          {data.ignoredCount > 0 ? (
            <SecondaryLink
              href="/ignored"
              label={`${String(data.ignoredCount)} hidden ${data.ignoredCount === 1 ? 'item' : 'items'}`}
            />
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}
