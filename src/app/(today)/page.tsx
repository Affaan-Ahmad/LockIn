import { redirect } from 'next/navigation';

import { TodayPaper } from '@/features/dashboard/today-paper';
import { TodayWorkbench } from '@/features/dashboard/today-workbench';
import { OfflineMirror } from '@/features/offline/OfflineMirror';
import type { OfflineAssignment } from '@/features/offline/store';
import { readSkin } from '@/lib/preferences';
import {
  loadDashboard,
  loadSetupState,
  requireSessionUser,
  type AssignmentView,
} from '@/lib/queries';

/**
 * Today. The screen the product exists for.
 *
 * This file loads and nothing else. The two skins are not one screen in
 * different colours -- they order the day differently, put different things in
 * the rail, and disagree about whether hierarchy is carried by material or by
 * headings -- so each owns its whole composition, and all they share is the
 * data and the redirects that guard it.
 *
 * Never cached. A cached dashboard shows yesterday's coursework as today's,
 * which is the exact failure the product is built to prevent.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function TodayPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const params = await searchParams;

  // Started together, not one after the other: every Supabase call is a round
  // trip to another region, and awaiting the setup check first added a full one
  // to the screen a student opens most.
  const setupPromise = loadSetupState(user.id);
  const dashboardPromise = loadDashboard(user.id);

  const setup = await setupPromise;
  if (!setup.hasConnection || !setup.hasProfile) redirect('/welcome');
  if (!setup.hasTrackedCourses) redirect('/courses?setup=1');

  const [data, skin] = await Promise.all([dashboardPromise, readSkin()]);

  const now = new Date();
  // Detail selection lives in the URL, so the panel costs no client state and
  // the back button closes it. An id that matches nothing simply shows the
  // normal rail rather than an error: a stale link should not break the page.
  const selectedId = typeof params['assignment'] === 'string' ? params['assignment'] : null;

  /**
   * The only coursework LockIn keeps on the device.
   *
   * Mounted here rather than inside either skin, because being able to read
   * your deadlines on a train is not a property of a colour scheme. It writes
   * what this render already fetched, so it costs no request and can never be
   * newer or older than what the student is looking at.
   *
   * Overdue and the near future only. The undated feed is deliberately left
   * out: an assignment with no due date cannot be acted on against a clock, and
   * a cached list is exactly where a wrong sense of urgency would do damage.
   */
  const mirror = (
    <OfflineMirror
      userId={user.id}
      timeZone={data.freshness.timeZone}
      overdue={data.overdue.map(toOffline)}
      dueSoon={data.upcoming.map(toOffline)}
    />
  );

  if (skin === 'workbench') {
    return (
      <>
        {mirror}
        <TodayWorkbench data={data} now={now} selectedId={selectedId} />
      </>
    );
  }

  return (
    <>
      {mirror}
      <TodayPaper userId={user.id} data={data} now={now} selectedId={selectedId} />
    </>
  );
}

/**
 * Narrows an assignment to the handful of fields the offline view renders.
 *
 * Explicitly a subset rather than the whole object. What goes to the device is
 * decided here, once, so a field added to `AssignmentView` later does not
 * silently start being written to local storage.
 */
function toOffline(item: AssignmentView): OfflineAssignment {
  return {
    assignmentId: item.assignmentId,
    courseName: item.courseName,
    title: item.title,
    dueAtUtc: item.deadline.dueAtUtc ?? null,
    dueDateUtc: item.deadline.dueDateUtc ?? null,
    submissionState: item.submissionState,
  };
}
