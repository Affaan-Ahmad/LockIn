import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AssignmentDetail } from '@/features/assignments/AssignmentDetail';
import { DeadlineGroups } from '@/features/dashboard/DeadlineGroups';
import { RailPanel } from '@/features/dashboard/RailPanel';
import { WorkloadHeader } from '@/features/dashboard/WorkloadHeader';
import { AutoSync } from '@/features/sync/AutoSync';
import { SyncButton } from '@/features/sync/SyncButton';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { urgencyBand } from '@/lib/format';
import type { DashboardData } from '@/lib/queries';

/**
 * Today, in the workbench design.
 *
 * The composition the product shipped with, preserved rather than deleted: one
 * flat list grouped by when work is due, a workload sentence above it, and a
 * rail of counts beside it. Where paper says the hierarchy in material -- a card
 * for what is late, raised sheets for today, a recessed table for the rest --
 * this says it in headings and order.
 *
 * Kept whole rather than approximated with paper parts. A skin that only
 * repainted the old design would be the new one wearing the old colours, which
 * is not what a student choosing "workbench" is asking for.
 */

export interface TodayWorkbenchProps {
  readonly data: DashboardData;
  readonly now: Date;
  readonly selectedId: string | null;
}

export function TodayWorkbench({ data, now, selectedId }: TodayWorkbenchProps) {
  const { timeZone } = data.freshness;

  const todayCount = data.upcoming.filter(
    (item) => urgencyBand(item.deadline, now, timeZone) === 'today',
  ).length;

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hour12: false }).format(now),
  );

  // Overdue first, deliberately. It is the most urgent thing a student has, and
  // burying it under future work is how it gets missed twice.
  const items = [...data.overdue, ...data.upcoming, ...data.undated];
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
            <section className="flex flex-col gap-3" aria-label="Classroom connection">
              <h2 className="context-heading">Classroom connection</h2>
              <SyncStatus freshness={data.freshness} />
              <p className="text-xs text-ink-soft">
                Refresh before you plan. A recent update does not guarantee every course is
                current.
              </p>
              <SyncButton />
            </section>
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
        upcomingCount={data.upcoming.length - todayCount}
        reviewCount={data.reviewCount}
        undatedCount={data.undated.length}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title="Nothing due in this view"
          body="No relevant coursework is listed here. Check review items and sync status before calling it a day."
          action={
            <ButtonLink href="/courses" variant="secondary">
              Manage courses
            </ButtonLink>
          }
        />
      ) : (
        <DeadlineGroups
          items={items}
          now={now}
          timeZone={timeZone}
          allowHideOverdue
          detailHrefFor={(id) => `/?assignment=${encodeURIComponent(id)}#assignment-details`}
          selectedId={selectedId}
        />
      )}
    </AppShell>
  );
}
