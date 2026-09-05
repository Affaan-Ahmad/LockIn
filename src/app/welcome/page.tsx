import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Footer } from '@/components/shell/Footer';
import { ButtonLink } from '@/components/ui/Button';
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
export const metadata = {
  title: 'LockIn — Your coursework, your section',
  description: 'See the Google Classroom coursework that applies to your section, track deadlines, and review unclear posts.',
  alternates: { canonical: 'https://lockinapp.tech/welcome' },
};

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
      <ButtonLink href="/api/auth/google" className="block" variant="primary" fullWidth>
          Continue with Google
        </ButtonLink>

      <GoogleAccessDisclosure />
    </StepFrame>
  );
}

/**
 * What Google access is about to be requested, said before it is requested.
 *
 * Both buttons that start OAuth render this, and it sits with the button rather
 * than behind a link, because a disclosure a person has to go looking for is not
 * a disclosure. Google's verification review looks for exactly this: the
 * requested scopes described in the product, in plain language, at the moment
 * consent is asked for.
 *
 * Every clause is checkable against `REQUIRED_CLASSROOM_SCOPES` and the code
 * that uses it. The claim that LockIn cannot submit or edit is not a promise of
 * restraint -- the four scopes it requests are read-only, so the capability is
 * absent rather than declined. Sign-in scopes are named too: the consent screen
 * will show them, and a disclosure that omits what the next screen displays
 * reads as concealment.
 */
function GoogleAccessDisclosure() {
  return (
    <div className="measure mt-5 flex flex-col gap-2 text-xs leading-relaxed text-ink-muted">
      <p>
        LockIn will read your Google Classroom <strong className="text-ink-soft">courses</strong>,{' '}
        <strong className="text-ink-soft">coursework</strong>,{' '}
        <strong className="text-ink-soft">topics</strong> and{' '}
        <strong className="text-ink-soft">your own submission status</strong>, so it can list your
        courses, organise deadlines, work out which work applies to your section, and stop showing
        work you have already turned in.
      </p>
      <p>
        The access is read-only: LockIn cannot submit, edit, grade or delete anything in Classroom.
        Signing in also uses your Google email address and account id, which is how it knows whose
        coursework to show. Google returns your grades with your submissions and LockIn discards
        them without storing them.
      </p>
      <p>
        You can disconnect Google or delete everything from Settings at any time. See the{' '}
        <Link href="/legal/privacy" className="font-medium text-brand-ink hover:underline">
          privacy policy
        </Link>{' '}
        for what is stored and for how long.
      </p>
    </div>
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
    <main className="mx-auto flex min-h-dvh max-w-[34rem] flex-col justify-center pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
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
      <ButtonLink href="/api/auth/google" className="block" variant="primary" fullWidth>
          {status === null ? 'Connect Classroom' : 'Reconnect Classroom'}
        </ButtonLink>

      <GoogleAccessDisclosure />
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
