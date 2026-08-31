import { AppShell } from '@/components/shell/AppShell';
import { CourseTracker } from '@/features/courses/CourseTracker';
import { SyncButton } from '@/features/sync/SyncButton';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { loadCourses, loadReviewCount, requireSessionUser } from '@/lib/queries';

/**
 * Which courses LockIn tracks.
 *
 * Course discovery and coursework sync are separate on purpose: listing courses
 * is one cheap call, while reading every assignment in them is not. Tracking a
 * course is what moves it from the first to the second, which is why this
 * screen exists at all rather than syncing everything a student can see.
 *
 * Doubles as step 3 of onboarding via ?setup=1. The list and the rules are
 * identical either way; only the copy and where Save goes change.
 */
export const dynamic = 'force-dynamic';

export default async function CoursesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const params = await searchParams;
  const setupMode = params['setup'] === '1';

  const [{ courses, freshness }, reviewCount] = await Promise.all([
    loadCourses(user.id),
    loadReviewCount(user.id),
    ]);

  return (
    <AppShell
      title={setupMode ? 'Choose your courses' : 'Courses'}
      subtitle={
        setupMode
          ? 'Pick the ones you are taking now. Old courses left off are never synced.'
          : 'Only tracked courses are synced for coursework.'
      }
      reviewCount={reviewCount}
      headerAside={<SyncStatus freshness={freshness} />}
    >
      <SyncStatus freshness={freshness} variant="banner" />

      {courses.length === 0 ? (
        <div className="surface-raised p-4">
          <p className="text-base font-semibold text-ink">No courses found yet</p>
          <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
            LockIn has not read your Classroom course list, or your account has no active courses.
          </p>
          <div className="mt-3">
            <SyncButton mode="FULL" label="Look for courses" />
          </div>
        </div>
      ) : (
        <CourseTracker courses={courses} setupMode={setupMode} />
      )}

      {courses.length === 0 || setupMode ? null : (
        <div className="mt-8 border-t border-line pt-5">
          <p className="measure text-sm leading-relaxed text-ink-soft">
            Turning a course on does not fetch its coursework straight away. Its assignments
            appear after the next sync.
          </p>
          <div className="mt-3">
            <SyncButton />
          </div>
        </div>
      )}
    </AppShell>
  );
}
