import Link from 'next/link';

import { AppShell } from '@/components/shell/AppShell';
import { buildLabel } from '@/config/version';
import { ProfileForm } from '@/features/onboarding/ProfileForm';
import { DangerZone } from '@/features/settings/DangerZone';
import { ThemeToggle } from '@/features/settings/ThemeToggle';
import { SyncButton } from '@/features/sync/SyncButton';
import { AutoSync } from '@/features/sync/AutoSync';
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
      <AutoSync level={data.freshness.level} />

      <div className="flex flex-col gap-8 in-data-[density=pointer]:grid in-data-[density=pointer]:grid-cols-2 in-data-[density=pointer]:items-start in-data-[density=pointer]:gap-x-8 in-data-[density=pointer]:gap-y-7">
        <section aria-labelledby="account">
          <SectionHeading id="account">Account</SectionHeading>
          <div className="surface-raised p-4">
            <p className="text-sm text-ink-muted">Signed in as</p>
            <p className="mt-1 text-base font-semibold break-all text-ink">
              {user.email ?? 'your Google account'}
            </p>
          </div>
        </section>

        <section aria-labelledby="section" className="in-data-[density=pointer]:col-span-2">
          <SectionHeading id="section">Your section</SectionHeading>
          <p className="measure mb-3 text-sm leading-relaxed text-ink-soft">
            Changing this re-checks every assignment on the next sync, so verdicts you see now may
            change.
          </p>
          {/* The whole saved profile, not a partial view of it. The form
              sends every field back, so any it was not given would be written
              as null -- erasing a programme code the student had entered. */}
          <ProfileForm initial={profile} nextHref="/settings" submitLabel="Save section" />
        </section>

        <section aria-labelledby="appearance">
          <SectionHeading id="appearance">Appearance</SectionHeading>
          <div className="surface-raised flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-soft">
              LockIn follows your device by default. Choose one to override it.
            </p>
            <ThemeToggle />
          </div>
        </section>

        <section aria-labelledby="data">
          <SectionHeading id="data">Your data</SectionHeading>
          <div className="surface-raised p-4">
            <p className="text-sm text-ink-soft">
              {setup.discoveredCourseCount} courses found, {data.trackedCourseCount} tracked. Last
              successful sync {formatAge(data.freshness.ageMs)}.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SyncButton mode="FULL" label="Re-check everything" />
            </div>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <li>
                <Link href="/courses" className="font-semibold text-brand-ink hover:underline">
                  Manage tracked courses
                </Link>
              </li>
              <li>
                <Link href="/ignored" className="font-semibold text-brand-ink hover:underline">
                  {data.ignoredCount > 0
                    ? `Hidden work (${String(data.ignoredCount)})`
                    : 'Hidden work'}
                </Link>
              </li>
              <li>
                <Link href="/review" className="font-semibold text-brand-ink hover:underline">
                  {data.reviewCount > 0
                    ? `Review and your answers (${String(data.reviewCount)})`
                    : 'Review and your answers'}
                </Link>
              </li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="connection" className="in-data-[density=pointer]:col-span-2">
          <SectionHeading id="connection">Connection and deletion</SectionHeading>
          <DangerZone connected={setup.hasConnection} />
        </section>

        <p className="measure text-xs leading-relaxed text-ink-muted in-data-[density=pointer]:col-span-2">
          LockIn reads your Classroom courses and coursework. It never posts, submits or changes
          anything in Classroom, and it does not share your coursework with anyone.
        </p>

        {/* Which build this is.
            
            Deliberately here and not hidden behind a debug flag: the first
            question worth asking about any bug report is "which version were
            you on", and a number nobody can find is a number nobody quotes.
            Quiet enough to ignore, present enough to read out. */}
        <p className="px-0.5 text-2xs text-ink-muted in-data-[density=pointer]:col-span-2">
          LockIn <span className="font-mono">{buildLabel()}</span>
        </p>
      </div>
    </AppShell>
  );
}

function SectionHeading({ id, children }: { readonly id: string; readonly children: string }) {
  return (
    <h2 id={id} className="mb-3 px-0.5 text-sm font-semibold text-ink-soft">
      {children}
    </h2>
  );
}
