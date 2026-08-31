import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { ProfileForm } from '@/features/onboarding/ProfileForm';
import { getSessionUser, loadSetupState } from '@/lib/queries';

/**
 * Onboarding, in the order the steps actually depend on each other.
 *
 * Sign in, connect Classroom, say which section you are in, choose courses.
 * Each step is skipped if already done, so a student who drops out halfway
 * returns to the step they were on rather than to the beginning.
 *
 * Deliberately outside AppShell. The navigation links to screens that cannot
 * work yet, and offering them during setup produces four dead ends.
 */
export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const user = await getSessionUser();

  if (user === null) return <SignInStep />;

  const setup = await loadSetupState(user.id);

  if (!setup.hasConnection) return <ConnectStep status={setup.connectionStatus} />;
  if (!setup.hasProfile) return <SectionStep />;

  // Course selection has a screen of its own, and it is the same screen a
  // student returns to later. One implementation, two entry points.
  if (!setup.hasTrackedCourses) redirect('/courses?setup=1');

  redirect('/');
}

function Frame({
  step,
  title,
  children,
}: {
  readonly step: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[34rem] flex-col justify-center px-5 py-12">
      <p className="text-[0.75rem] font-bold tracking-[0.08em] text-brand uppercase">{step}</p>
      <h1 className="mt-2 text-[1.875rem] leading-[1.15] font-bold text-balance text-ink">
        {title}
      </h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}

function SignInStep() {
  return (
    <Frame step="LockIn" title="Every deadline that is actually yours.">
      <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
        Your section shares a Google Classroom with several others, so most of what gets posted is
        not for you. LockIn reads the section out of each post and shows you the rest.
      </p>
      <a href="/api/auth/google" className="mt-6 block">
        <Button variant="primary" fullWidth>
          Continue with Google
        </Button>
      </a>
      <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-muted">
        LockIn asks for read-only access to your Classroom courses and coursework. It never posts,
        submits, or changes anything in Classroom.
      </p>
    </Frame>
  );
}

function ConnectStep({ status }: { readonly status: string | null }) {
  return (
    <Frame step="Step 1 of 3" title="Connect Google Classroom">
      <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
        {status === 'REVOKED' || status === 'EXPIRED'
          ? 'Your Classroom access has expired. Reconnecting restores it; nothing you have already decided is lost.'
          : 'LockIn needs read access to your courses and coursework. Nothing is posted, submitted or changed.'}
      </p>
      <a href="/api/auth/google" className="mt-6 block">
        <Button variant="primary" fullWidth>
          {status === null ? 'Connect Classroom' : 'Reconnect Classroom'}
        </Button>
      </a>
    </Frame>
  );
}

function SectionStep() {
  return (
    <Frame step="Step 2 of 3" title="Which section are you in?">
      <p className="mb-6 text-[0.9375rem] leading-relaxed text-ink-soft">
        This is the one thing LockIn cannot work out on its own, and everything else depends on it.
      </p>
      <ProfileForm initial={null} nextHref="/courses?setup=1" submitLabel="Save and continue" />
    </Frame>
  );
}
