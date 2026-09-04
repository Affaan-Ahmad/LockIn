import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AssignmentDetail } from '@/features/assignments/AssignmentDetail';
import { DeadlineGroups } from '@/features/dashboard/DeadlineGroups';
import { RailPanel } from '@/features/dashboard/RailPanel';
import { WorkloadHeader } from '@/features/dashboard/WorkloadHeader';
import { AutoSync } from '@/features/sync/AutoSync';
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

export default async function TodayPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const params = await searchParams;

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

  // Detail selection lives in the URL, so the panel costs no client state and
  // the back button closes it. An id that matches nothing simply shows the
  // normal rail rather than an error: a stale link should not break the page.
  const selectedId = typeof params['assignment'] === 'string' ? params['assignment'] : null;
  const selected = items.find((item) => item.assignmentId === selectedId) ?? null;

  return (
    <AppShell
      title="Today"
      reviewCount={data.reviewCount}
      headerAside={<SyncStatus freshness={data.freshness} />}
      rail={
        selected !== null ? (
          <AssignmentDetail item={selected} now={now} timeZone={timeZone} closeHref="/" />
        ) : (
        <>
          {data.reviewCount > 0 ? (
            <RailPanel
              title="Needs a decision"
              value={String(data.reviewCount)}
              hint="LockIn could not tell whether these are for your section."
              href="/review"
              tone="review"
            />
          ) : null}
          <RailPanel
            title="Courses"
            value={String(data.trackedCourseCount)}
            hint="tracked for coursework"
            href="/courses"
          />
          {data.ignoredCount > 0 ? (
            <RailPanel
              title="Hidden"
              value={String(data.ignoredCount)}
              hint="not shown in your lists"
              href="/ignored"
            />
          ) : null}
        </>
        )
      }
    >
      <SyncStatus freshness={data.freshness} variant="banner" />
      <AutoSync level={data.freshness.level} />

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
        <DeadlineGroups
          items={items}
          now={now}
          timeZone={timeZone}
          allowHideOverdue
          detailHrefFor={(id) => `/?assignment=${id}`}
          selectedId={selectedId}
        />
      )}

    </AppShell>
  );
}
