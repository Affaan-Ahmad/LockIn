import { redirect } from 'next/navigation';

import { TodayPaper } from '@/features/dashboard/today-paper';
import { TodayWorkbench } from '@/features/dashboard/today-workbench';
import { readSkin } from '@/lib/preferences';
import { loadDashboard, loadSetupState, requireSessionUser } from '@/lib/queries';

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

  if (skin === 'workbench') {
    return <TodayWorkbench data={data} now={now} selectedId={selectedId} />;
  }

  return <TodayPaper userId={user.id} data={data} now={now} selectedId={selectedId} />;
}
