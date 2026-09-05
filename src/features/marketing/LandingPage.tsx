import Link from 'next/link';
import { LockInMark } from '@/components/icons';
import { Footer } from '@/components/shell/Footer';
import { ButtonLink } from '@/components/ui/Button';

export function LandingPage() {
  return (
    <div className="marketing-frame">
      <header className="marketing-header">
        <Link href="/welcome" aria-label="LockIn home" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <LockInMark className="size-6" /> LockIn
        </Link>
        <ButtonLink href="/welcome?signin=1">Sign in</ButtonLink>
      </header>
      <main>
        <section className="marketing-hero">
          <div>
            <p className="mb-4 text-sm font-medium text-brand-ink">Your coursework. Your section.</p>
            <h1>Know what’s yours.<br />See what’s next.</h1>
            <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-ink-soft">
              One Google Classroom. Several university sections. LockIn brings the work that applies to you into one clear deadline view.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <ButtonLink href="/welcome?signin=1" variant="primary">Continue with Google</ButtonLink>
              <a href="#how-it-works" className="button-link text-brand-ink">See how it works</a>
            </div>
            <p className="mt-4 text-xs text-ink-muted">Read-only Classroom access. You choose what to track.</p>
          </div>
          <figure className="marketing-example">
            <figcaption className="marketing-example-label">
              <span>Illustrative coursework</span><span>Section G</span>
            </figcaption>
            <p className="mb-3 text-xl font-semibold text-ink">A clearer plan for today</p>
            <ul>
              <li>
                <p className="text-xs text-ink-muted">Data Structures</p>
                <p className="mt-1 text-base font-medium">Section G: Linked lists</p>
                <p className="mt-2 text-sm text-ink-soft">Today · 5:00 pm <span className="ml-2 font-medium text-brand-ink">For you</span></p>
              </li>
              <li>
                <p className="text-xs text-ink-muted">Technical Writing</p>
                <p className="mt-1 text-base font-medium">Report outline · All sections</p>
                <p className="mt-2 text-sm text-ink-soft">Tomorrow · No time given</p>
              </li>
              <li>
                <p className="text-xs text-ink-muted">Programming Fundamentals</p>
                <p className="mt-1 text-base font-medium">Lab group make-up task</p>
                <p className="mt-2 text-sm text-review">Needs review · Section unclear</p>
              </li>
            </ul>
            <p className="mt-3 text-xs text-ink-muted">Example only. Your actual coursework appears after connecting.</p>
          </figure>
        </section>
        <section id="how-it-works" className="marketing-section scroll-mt-8">
          <div>
            <h2>Shared Classroom.<br />Different assignments.</h2>
            <p className="mt-4 max-w-[34ch] text-base leading-relaxed text-ink-soft">A post for another section can look just as urgent as your own. You should not have to open every one to find out.</p>
          </div>
          <div className="marketing-points">
            <Point title="Give your section a name" body="Tell LockIn your section and programme. It recognises the section spellings teachers use in coursework." />
            <Point title="Keep this term in view" body="Choose the courses you want to track. Old Classrooms stay out of your plan unless you select them." />
            <Point title="Read deadlines, then get to work" body="See overdue work, today’s deadlines and what comes next. Open the original assignment in Classroom when you need it." />
          </div>
        </section>
        <section className="marketing-section">
          <h2>Unclear posts deserve a question.</h2>
          <div>
            <p className="text-lg leading-relaxed text-ink-soft">When LockIn cannot confidently match a post to your section, it asks you to review it.</p>
            <p className="mt-4 text-base leading-relaxed text-ink-soft">See the section information it found. Choose “This is for me” or “Not for me”. Your decision is yours to undo.</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">Missing dates stay missing. Older data is labeled. If only some courses sync, you’ll know.</p>
          </div>
        </section>
        <section className="marketing-section marketing-privacy">
          <h2>Your Classroom stays yours.</h2>
          <div>
          <p className="measure mt-4 text-base leading-relaxed text-ink-soft">
            Read-only access to your courses, coursework, topics and your own submission status,
            plus the email address you sign in with. It cannot post, submit, grade, or change
            anything in Classroom, because the permissions it asks for do not allow it. Google sends
            your grades along with your submission status; LockIn discards them and has nowhere to
            store them.
          </p>
          <p className="measure mt-3 text-base leading-relaxed text-ink-soft">
            You can disconnect Google or delete everything from Settings, without asking anyone.
          </p>
          <p className="measure mt-3 text-sm leading-relaxed text-ink-muted">
            LockIn&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="font-medium text-brand-ink hover:underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <Link href="/legal/privacy" className="font-medium text-brand-ink hover:underline">
              Privacy policy
            </Link>
            <Link href="/legal/terms" className="font-medium text-brand-ink hover:underline">
              Terms
            </Link>
            <Link href="/legal/disclaimer" className="font-medium text-brand-ink hover:underline">
              What it can get wrong
            </Link>
          </div>
          </div>
        </section>
        <section className="marketing-close">
          <h2 className="text-xl font-semibold text-ink">Make room for the work that matters.</h2>
          <ButtonLink href="/welcome?signin=1" variant="primary">Continue with Google</ButtonLink>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Point({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div>
      <h3 className="text-base font-medium text-ink">{title}</h3>
      <p className="mt-2 max-w-[58ch] text-base leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}
