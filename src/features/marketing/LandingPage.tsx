import Link from 'next/link';

import { LockInMark } from '@/components/icons';
import { Footer } from '@/components/shell/Footer';
import { Button } from '@/components/ui/Button';

/**
 * What LockIn is, for someone who has never heard of it.
 *
 * This replaces sending a stranger straight to a Google consent prompt. Asking
 * for read access to somebody's coursework before explaining why is the single
 * most suspicious thing a web page can do, and it is also what Google's OAuth
 * reviewers will land on.
 *
 * Four sections and no more. The product solves one specific problem for one
 * specific kind of person, and a page that says so once is more convincing than
 * one that says it six ways. No invented metrics, no testimonials, no logo wall
 * -- there are no customers yet, and pretending otherwise on the page where
 * someone decides whether to trust us with their Classroom account would be
 * exactly the wrong trade.
 *
 * Expressive typography is allowed here in a way it is not in the app. This is
 * the one surface whose job is persuasion rather than throughput.
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[64rem] items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-ink">
          <LockInMark className="size-6 shrink-0" />
          LockIn
        </span>
        <Link href="/welcome?signin=1">
          <Button variant="secondary" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="mx-auto max-w-[64rem] px-5 sm:px-8">
        {/* Hero. Two lines of headline, one short paragraph, one action. */}
        <section className="py-16 sm:py-24">
          <h1 className="max-w-[16ch] text-3xl leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-ink sm:text-4xl">
            Every deadline that is actually yours.
          </h1>
          <p className="measure mt-5 text-lg leading-relaxed text-ink-soft">
            Your section shares a Google Classroom with several others, so most of what gets posted
            is for somebody else. LockIn reads the section out of each post and shows you the rest.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/welcome?signin=1">
              <Button variant="primary" className="px-7">
                Continue with Google
              </Button>
            </Link>
            <span className="text-xs text-ink-muted">Read-only. Free.</span>
          </div>
        </section>

        {/* The problem, stated concretely rather than as a benefit. */}
        <section className="border-t border-line py-14">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">
            One Classroom, five sections
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <Point
              title="A teacher posts once"
              body="They write “Sec G: Task 01” in the title, or name a section in the description, or leave it out entirely because it is for everyone."
            />
            <Point
              title="Everyone sees everything"
              body="Classroom has no idea your section exists. Eleven of fourteen assignments in a shared course may have nothing to do with you."
            />
            <Point
              title="You check anyway"
              body="Because the one time you do not is the time it was yours. That is the tax LockIn removes."
            />
          </div>
        </section>

        {/* How it works, including the part most products would hide. */}
        <section className="border-t border-line py-14">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">
            How LockIn decides
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <Point
              title="You name your section"
              body="LockIn works out the spellings teachers use: G, Sec G, Section G, BCS-5G. You see the list before it matches anything."
            />
            <Point
              title="You pick your courses"
              body="Only the courses you are taking now get synced, so last year's Classrooms stay out of your deadlines."
            />
            <Point
              title="It admits when it is unsure"
              body="An ambiguous post goes to a Review screen with the evidence it found, and you decide. It never guesses quietly."
            />
          </div>
        </section>

        {/* Privacy, because this is the objection that matters here. */}
        <section className="border-t border-line py-14">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">
            What LockIn can and cannot do
          </h2>
          <p className="measure mt-4 text-base leading-relaxed text-ink-soft">
            Read-only access to your courses and coursework, and nothing else. It cannot post,
            submit, grade, or change anything in Classroom, because it never asks for permission to.
            Google sends your grades along with your submission status; LockIn discards them and has
            nowhere to store them.
          </p>
          <p className="measure mt-3 text-base leading-relaxed text-ink-soft">
            You can disconnect Google or delete everything from Settings, immediately, without
            asking anyone.
          </p>
          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <Link href="/legal/privacy" className="font-medium text-brand-ink hover:underline">
              Privacy policy
            </Link>
            <Link href="/legal/disclaimer" className="font-medium text-brand-ink hover:underline">
              What it can get wrong
            </Link>
          </div>
        </section>

        <section className="border-t border-line py-14">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-balance text-ink">
            Stop reading every post to find the one that was yours.
          </h2>
          <div className="mt-6">
            <Link href="/welcome?signin=1">
              <Button variant="primary" className="px-7">
                Continue with Google
              </Button>
            </Link>
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}

function Point({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-base font-medium text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-pretty text-ink-soft">{body}</p>
    </div>
  );
}
