import Link from 'next/link';

import { AppShell } from '@/components/shell/AppShell';
import { ProfileForm } from '@/features/onboarding/ProfileForm';
import { DangerZone } from '@/features/settings/DangerZone';
import { SyncButton } from '@/features/sync/SyncButton';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { formatAge } from '@/lib/format';
import { loadDashboard, loadProfile, loadSetupState, requireSessionUser } from '@/lib/queries';

/**
 * Account, section, connection, deletion.
 *
 * Reached from the header rather than the navigation bar: a fifth destination
 * would dilute the four a student actually opens, and this one is visited
 * rarely. Everything here is a decision about the account, not about a
 * deadline.
 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireSessionUser();
  const [setup, data, profile] = await Promise.all([
    loadSetupState(user.id),
    loadDashboard(user.id),
    loadProfile(user.id),
  ]);

  return (
    <AppShell title="Settings" reviewCount={data.reviewCount}>
      {/* A failed or stale sync belongs here too: this is where a student
          comes to find out why nothing is updating. */}
      <SyncStatus freshness={data.freshness} variant="banner" />

      <div className="flex flex-col gap-9">
        <section aria-labelledby="account">
          <SectionHeading id="account">Account</SectionHeading>
          <div className="surface-raised p-4">
            <p className="text-[0.8125rem] text-ink-muted">Signed in as</p>
            <p className="mt-0.5 text-[0.9375rem] font-semibold break-all text-ink">
              {user.email ?? 'your Google account'}
            </p>
          </div>
        </section>

        <section aria-labelledby="section">
          <SectionHeading id="section">Your section</SectionHeading>
          <p className="mb-4 text-[0.8125rem] leading-relaxed text-ink-soft">
            Changing this re-checks every assignment on the next sync, so verdicts you see now may
            change.
          </p>
          {/* The whole saved profile, not a partial view of it. The form
              sends every field back, so any it was not given would be written
              as null -- erasing a programme code the student had entered. */}
          <ProfileForm initial={profile} nextHref="/settings" submitLabel="Save section" />
        </section>

        <section aria-labelledby="data">
          <SectionHeading id="data">Your data</SectionHeading>
          <div className="surface-raised p-4">
            <p className="text-[0.8125rem] text-ink-soft">
              {setup.discoveredCourseCount} courses found, {data.trackedCourseCount} tracked. Last
              successful sync {formatAge(data.freshness.ageMs)}.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SyncButton mode="FULL" label="Re-check everything" />
            </div>
            <ul className="mt-4 flex flex-col gap-1.5 text-[0.875rem]">
              <li>
                <Link href="/courses" className="font-semibold text-brand hover:underline">
                  Manage tracked courses
                </Link>
              </li>
              <li>
                <Link href="/ignored" className="font-semibold text-brand hover:underline">
                  {data.ignoredCount > 0
                    ? `Hidden work (${String(data.ignoredCount)})`
                    : 'Hidden work'}
                </Link>
              </li>
              <li>
                <Link href="/review" className="font-semibold text-brand hover:underline">
                  {data.reviewCount > 0
                    ? `Review and your answers (${String(data.reviewCount)})`
                    : 'Review and your answers'}
                </Link>
              </li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="connection">
          <SectionHeading id="connection">Connection and deletion</SectionHeading>
          <DangerZone connected={setup.hasConnection} />
        </section>

        <p className="text-[0.75rem] leading-relaxed text-ink-muted">
          LockIn reads your Classroom courses and coursework. It never posts, submits or changes
          anything in Classroom, and it does not share your coursework with anyone.
        </p>
      </div>
    </AppShell>
  );
}

function SectionHeading({ id, children }: { readonly id: string; readonly children: string }) {
  return (
    <h2
      id={id}
      className="mb-2.5 px-1 text-[0.75rem] font-bold tracking-[0.06em] text-ink-muted uppercase"
    >
      {children}
    </h2>
  );
}
