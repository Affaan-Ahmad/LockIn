import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { Footer } from '@/components/shell/Footer';
import { Button } from '@/components/ui/Button';
import { LandingPage } from '@/features/marketing/LandingPage';
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
 *
 * Two compositions, not one. The sign-in screen is the only marketing surface
 * in the product and gets an asymmetric split; the steps after it are focused
 * single tasks and get a narrow centred column, because centring a form is what
 * makes it feel like one decision rather than a page to survey.
 */
export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();

  if (user === null) {
    // A stranger gets the explanation; someone who clicked "sign in" gets the
    // button they asked for. Sending a first-time visitor straight to a Google
    // consent prompt asks for read access to their coursework before saying
    // what the product is, which is the most suspicious thing a page can do --
    // and it is the page Google's OAuth reviewers land on.
    const params = await searchParams;
    return params['signin'] === '1' ? <SignInScreen /> : <LandingPage />;
  }

  const setup = await loadSetupState(user.id);

  if (!setup.hasConnection) return <ConnectStep status={setup.connectionStatus} />;
  if (!setup.hasProfile) return <SectionStep />;

  // Course selection has a screen of its own, and it is the same screen a
  // student returns to later. One implementation, two entry points.
  if (!setup.hasTrackedCourses) redirect('/courses?setup=1');

  redirect('/');
}

/**
 * The sign-in step.
 *
 * Only reached deliberately, from a "Continue with Google" or "Sign in" on the
 * landing page, so it does not sell. It used to: a split layout with a
 * headline, a value proposition and a half-screen reserved for a hero image,
 * because before the landing page existed this was the first thing a stranger
 * saw and it had to do that job.
 *
 * It no longer does, and repeating the pitch someone has just read, beside an
 * empty column waiting on an image that would never be worth commissioning for
 * a sign-in screen, was worse than saying nothing. So it is now one focused
 * task in a narrow column, matching the setup steps that follow it.
 *
 * The consent note stays. It is the one thing a student needs at the moment
 * they are about to grant access, rather than the moment they were reading
 * about the product.
 */
function SignInScreen() {
  return (
    <StepFrame
      step="LockIn"
      title="Sign in with Google"
      intro="LockIn reads your Classroom coursework and shows you the work that is for your section."
    >
      <a href="/api/auth/google" className="block">
        <Button variant="primary" fullWidth>
          Continue with Google
        </Button>
      </a>

      <p className="measure mt-5 text-xs leading-relaxed text-ink-muted">
        Read-only access to your Classroom courses and coursework. LockIn never posts, submits or
        changes anything, and you can disconnect or delete everything at any time.
      </p>
    </StepFrame>
  );
}

function StepFrame({
  step,
  title,
  intro,
  children,
}: {
  readonly step: string;
  readonly title: string;
  readonly intro: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[34rem] flex-col justify-center px-5 py-12">
      <p className="text-sm font-semibold text-brand-ink">{step}</p>
      <h1 className="mt-2 text-2xl font-semibold text-balance text-ink">
        {title}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">{intro}</p>
      <div className="mt-8">{children}</div>
      <Footer />
    </main>
  );
}

function ConnectStep({ status }: { readonly status: string | null }) {
  const expired = status === 'REVOKED' || status === 'EXPIRED';

  return (
    <StepFrame
      step="Step 1 of 3"
      title="Connect Google Classroom"
      intro={
        expired
          ? 'Your Classroom access has expired. Reconnecting restores it, and nothing you have already decided is lost.'
          : 'LockIn needs read access to your courses and coursework. Nothing is posted, submitted or changed.'
      }
    >
      <a href="/api/auth/google" className="block">
        <Button variant="primary" fullWidth>
          {status === null ? 'Connect Classroom' : 'Reconnect Classroom'}
        </Button>
      </a>
    </StepFrame>
  );
}

function SectionStep() {
  return (
    <StepFrame
      step="Step 2 of 3"
      title="Which section are you in?"
      intro="This is the one thing LockIn cannot work out on its own, and everything else depends on it."
    >
      <ProfileForm initial={null} nextHref="/courses?setup=1" submitLabel="Save and continue" />
    </StepFrame>
  );
}
