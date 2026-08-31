import type { ReactNode } from 'react';
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
 *
 * Two compositions, not one. The sign-in screen is the only marketing surface
 * in the product and gets an asymmetric split; the steps after it are focused
 * single tasks and get a narrow centred column, because centring a form is what
 * makes it feel like one decision rather than a page to survey.
 */
export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const user = await getSessionUser();

  if (user === null) return <SignInScreen />;

  const setup = await loadSetupState(user.id);

  if (!setup.hasConnection) return <ConnectStep status={setup.connectionStatus} />;
  if (!setup.hasProfile) return <SectionStep />;

  // Course selection has a screen of its own, and it is the same screen a
  // student returns to later. One implementation, two entry points.
  if (!setup.hasTrackedCourses) redirect('/courses?setup=1');

  redirect('/');
}

/**
 * The first screen anyone sees.
 *
 * Split rather than centred: a centred stack of headline, paragraph and button
 * is the default composition of every generated landing page, and this one has
 * a genuine second column to fill, so it earns the asymmetry.
 *
 * Four text elements at most, and the consent note is one of them. No trust
 * strip, no version pill, no scroll cue: there is nothing below this screen to
 * scroll to.
 */
function SignInScreen() {
  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex min-h-dvh flex-col justify-center px-6 py-14 sm:px-10 lg:min-h-0 lg:px-14">
        <div className="w-full max-w-[30rem]">
          <p className="text-[0.75rem] font-bold tracking-[0.08em] text-brand uppercase">LockIn</p>

          <h1 className="mt-3 text-[2.125rem] leading-[1.08] font-bold tracking-[-0.03em] text-balance text-ink sm:text-[2.5rem]">
            Every deadline that is actually yours.
          </h1>

          <p className="mt-4 max-w-[34ch] text-[1.0625rem] leading-relaxed text-ink-soft">
            Your section shares a Classroom with several others. LockIn reads the section out of
            each post and shows you the rest.
          </p>

          <a href="/api/auth/google" className="mt-8 block sm:inline-block">
            <Button variant="primary" fullWidth className="sm:w-auto sm:px-8">
              Continue with Google
            </Button>
          </a>

          <p className="mt-5 max-w-[42ch] text-[0.75rem] leading-relaxed text-ink-muted">
            Read-only access to your Classroom courses and coursework. LockIn never posts, submits
            or changes anything.
          </p>
        </div>
      </div>

      {/*
        The second column.

        Left as a deliberate blank rather than filled with a hand-drawn preview
        of the product. A stack of divs dressed up as a screenshot is the most
        recognisable tell in a generated interface, and a mock feed of invented
        assignments would be fabricated coursework on the one screen where a
        student is deciding whether to trust us with the real thing.

        TODO: real hero visual, roughly 1200x1400 portrait, light and dark
        variants. A photograph of a student at a desk, or a genuine screenshot
        of Today taken from a real account. Not stock illustration.
      */}
      <div
        aria-hidden="true"
        className="surface-sunken hidden lg:block lg:min-h-dvh lg:rounded-none"
      />
    </main>
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
      <p className="text-[0.8125rem] font-semibold text-brand">{step}</p>
      <h1 className="mt-2 text-[1.75rem] leading-[1.15] font-bold tracking-[-0.02em] text-balance text-ink">
        {title}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">{intro}</p>
      <div className="mt-7">{children}</div>
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
