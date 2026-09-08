import { CheckIcon } from '@/components/icons';
import { PaperButtonLink, RecessedWell, SyncPill, type SyncTone } from '@/components/paper';
import { PaperShell } from '@/components/shell/PaperShell';
import { AssignmentDetail } from '@/features/assignments/AssignmentDetail';
import {
  DueTodaySection,
  LateCard,
  NeedsReviewCard,
  ThisWeekTable,
  TrackedCard,
} from '@/features/dashboard/paper-today';
import { AutoSync } from '@/features/sync/AutoSync';
import { SyncButton } from '@/features/sync/SyncButton';
import { formatAge, urgencyBand } from '@/lib/format';
import { readTimeFormat } from '@/lib/preferences';
import { loadCourses, loadDecisions, type DashboardData } from '@/lib/queries';

/**
 * Today, in the paper design.
 *
 * Built as a stack of paper: what is already late is a card of its own, what is
 * due before the day ends is a set of raised sheets, and what is merely coming
 * is one recessed table. The ordering is by what a student can still act on,
 * and the material carries the hierarchy so it survives greyscale.
 *
 * A Server Component throughout. The only JavaScript on the page is the
 * navigation island and the sync control.
 */

const SYNC_TONE: Readonly<Record<string, SyncTone>> = {
  FRESH: 'moss',
  AGEING: 'glow-deep',
  STALE: 'glow-deep',
  PARTIAL: 'glow-deep',
  UNAVAILABLE: 'terra',
};

export interface TodayPaperProps {
  readonly userId: string;
  readonly data: DashboardData;
  readonly now: Date;
  readonly selectedId: string | null;
}

export async function TodayPaper({ userId, data, now, selectedId }: TodayPaperProps) {
  const { timeZone } = data.freshness;

  // Fetched here rather than in the page, so the workbench skin never pays for
  // the two queries only this composition uses.
  const [timeFormat, review, courseData] = await Promise.all([
    readTimeFormat(),
    data.reviewCount > 0 ? loadDecisions(userId) : Promise.resolve([]),
    loadCourses(userId),
  ]);

  const dueToday = data.upcoming.filter(
    (item) => urgencyBand(item.deadline, now, timeZone) === 'today',
  );
  const later = data.upcoming.filter((item) => {
    const band = urgencyBand(item.deadline, now, timeZone);
    return band === 'tomorrow' || band === 'thisWeek';
  });

  const items = [...data.overdue, ...data.upcoming, ...data.undated];
  const selected = items.find((item) => item.assignmentId === selectedId) ?? null;

  const dateLine = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(now);

  const staleCourse = data.freshness.level === 'PARTIAL' ? data.freshness.reason : null;

  return (
    <PaperShell
      title="Today"
      subtitle={`${dateLine} · ${String(dueToday.length)} due · ${String(data.overdue.length)} late`}
      reviewCount={data.reviewCount}
      headerAside={
        <>
          <SyncPill tone={SYNC_TONE[data.freshness.level] ?? 'glow-deep'}>
            {data.freshness.level === 'FRESH' || data.freshness.level === 'AGEING'
              ? `Updated ${formatAge(data.freshness.ageMs)}`
              : data.freshness.reason}
          </SyncPill>
          <SyncButton />
        </>
      }
    >
      <AutoSync level={data.freshness.level} />

      {items.length === 0 ? (
        <RecessedWell className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex size-10 items-center justify-center rounded-xs bg-p3 shadow-lift-1">
            <CheckIcon className="size-5 text-moss" />
          </span>
          <h2 className="text-[16px] font-bold tracking-[-0.02em] text-ink">
            You&rsquo;re all caught up.
          </h2>
          <p className="max-w-[34ch] text-[13px] text-ink-soft">
            Nothing is due right now. Check the review screen and how recently LockIn synced before
            calling it a day.
          </p>
          <PaperButtonLink href="/upcoming" variant="secondary" size="md" className="mt-1">
            See this week
          </PaperButtonLink>
        </RecessedWell>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_336px] lg:gap-[26px]">
          <div className="min-w-0">
            <LateCard items={data.overdue} now={now} timeZone={timeZone} timeFormat={timeFormat} />
            <DueTodaySection
              items={dueToday}
              now={now}
              timeZone={timeZone}
              timeFormat={timeFormat}
            />
            <ThisWeekTable items={later} now={now} timeZone={timeZone} timeFormat={timeFormat} />
          </div>

          <div className="min-w-0">
            {selected === null ? (
              <>
                <NeedsReviewCard item={review[0]} remaining={data.reviewCount} />
                <TrackedCard courses={courseData.courses} staleNote={staleCourse} />
              </>
            ) : (
              <AssignmentDetail item={selected} now={now} timeZone={timeZone} closeHref="/" />
            )}
          </div>
        </div>
      )}
    </PaperShell>
  );
}
