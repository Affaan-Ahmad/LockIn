import Link from 'next/link';

import { Footer } from '@/components/shell/Footer';
import {
  Annotation,
  Caption,
  ContourCard,
  LayeredCard,
  PaperBadge,
  PaperButtonLink,
  PaperTab,
  PaperToggle,
  RecessedWell,
  SyncPill,
  LogoTile,
} from '@/components/paper';
import { cx } from '@/lib/cx';

/**
 * The public landing page, cut from paper.
 *
 * The hero is a well pressed into the page with a warm light behind it and a
 * bank of curled paper clouds along its floor. Everything above that floor is a
 * sheet, and the copy block is one of only two things in the entire product
 * allowed contour stacking — the other is Needs Review — because it is the one
 * object the page exists to put in front of you.
 *
 * The preview card is labelled as an example twice, in the caption and in the
 * footnote. A product whose whole claim is that it never invents coursework
 * cannot show fabricated coursework that looks like yours without saying so.
 */

export function LandingPage() {
  return (
    <div className="grain min-h-dvh bg-p0 text-ink">
      <Header />
      <main>
        <Hero />
        <Problem />
        <Filtering />
        <ReviewSection />
        <CoursesAndFreshness />
        <Privacy />
        <ClosingCta />
      </main>
      <div className="mx-auto w-full max-w-[1280px] px-5 pb-10 lg:px-[60px]">
        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 bg-p0/95 backdrop-blur-[2px]">
      <div className="mx-auto flex w-full max-w-[1280px] items-center gap-4 px-5 py-3 lg:px-[60px]">
        <Link
          href="/welcome"
          aria-label="LockIn home"
          className="flex items-center gap-2.5 focus-visible:paper-focus"
        >
          <LogoTile size={30} />
          <span className="text-[16px] font-bold tracking-[-0.03em]">LockIn</span>
        </Link>

        <nav aria-label="Sections" className="mx-auto hidden items-end gap-1 md:flex">
          <PaperTab href="#overview" active>
            Overview
          </PaperTab>
          <PaperTab href="#how-it-works">How it works</PaperTab>
          <PaperTab href="#privacy">Privacy</PaperTab>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <PaperButtonLink href="/welcome?signin=1" variant="secondary" size="sm">
            Sign in
          </PaperButtonLink>
          <PaperButtonLink href="/welcome?signin=1" variant="primary" size="sm">
            Get started
          </PaperButtonLink>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="overview" className="mx-auto w-full max-w-[1280px] px-5 pt-4 pb-12 lg:px-[60px]">
      <div className="relative isolate overflow-hidden rounded-lg bg-gradient-to-b from-p3 via-p2 to-p1 shadow-press">
        {/* The light behind the paper. It breathes slowly; at rest it is a warm
            pool rather than a glare. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[40%] left-1/2 -z-10 h-[320px] w-[720px] max-w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-glow opacity-70 blur-[70px] motion-safe:animate-[breathe_12s_ease-in-out_infinite]"
        />

        <div className="grid items-start gap-8 px-5 pt-12 pb-6 lg:grid-cols-[520px_1fr] lg:gap-10 lg:px-14 lg:pt-14">
          <ContourCard className="p-6 lg:p-8">
            <PaperBadge className="font-mono tracking-[0.14em] uppercase">
              Google Classroom, filtered
            </PaperBadge>

            <h1 className="mt-4 text-[34px] leading-[1.03] font-bold tracking-[-0.04em] text-ink lg:text-[42px]">
              See only the coursework that applies to your section.
            </h1>

            <p className="mt-4 max-w-[46ch] text-[14.5px] leading-[1.65] text-ink-soft">
              One Classroom, many sections, different deadlines. LockIn sorts what is yours, asks
              when it is not sure, and shows what is due next.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <PaperButtonLink href="/welcome?signin=1" variant="primary" size="lg">
                Continue with Google
              </PaperButtonLink>
              <PaperButtonLink href="#how-it-works" variant="secondary" size="lg">
                How filtering works
              </PaperButtonLink>
            </div>

            <p className="mt-4 text-[12px] text-ink-faint">
              Read-only Classroom access. You choose which courses to track.
            </p>
          </ContourCard>

          <div className="relative lg:pt-6">
            <Annotation rotate={-4} className="absolute -top-2 left-2 z-10 lg:left-6">
              your section only
            </Annotation>
            <WeekPreview />
          </div>
        </div>

        <CloudBank />
      </div>
    </section>
  );
}

/**
 * A bank of curled paper clouds along the floor of the hero.
 *
 * Nested rings rather than images: an edge ring in kraft, a sheet disc inside
 * it, then an inner edge and disc, so each puff reads as cut card seen slightly
 * from the side. Three rows at decreasing size give the depth.
 */
function CloudBank() {
  // Three depth rows. Each puff is a circle, not an oval: the reference reads
  // as cut discs seen face-on, and stretching them turns the bank into a row of
  // lozenges. Sizes vary within a row and the puffs overlap, so the edge of the
  // bank is ragged the way torn card is.
  const rows: readonly {
    readonly sizes: readonly number[];
    readonly bottom: number;
    readonly opacity: string;
  }[] = [
    { sizes: [150, 96, 176, 120, 190, 104, 160, 128, 182], bottom: 26, opacity: 'opacity-45' },
    { sizes: [104, 148, 88, 132, 112, 158, 96, 140, 120, 92], bottom: 14, opacity: 'opacity-75' },
    { sizes: [64, 92, 56, 78, 68, 100, 60, 84, 72, 96, 58, 88], bottom: 2, opacity: 'opacity-100' },
  ];

  return (
    <div aria-hidden="true" className="relative h-[150px] overflow-hidden lg:h-[190px]">
      {rows.map((row) => (
        <div
          key={row.bottom}
          className={cx('absolute inset-x-0 flex items-end justify-center', row.opacity)}
          style={{ bottom: row.bottom }}
        >
          {row.sizes.map((size, i) => (
            <span
              key={`${String(row.bottom)}-${String(i)}`}
              className="flex shrink-0 items-center justify-center rounded-full border-[3px] border-kraft-2 bg-p2"
              style={{ width: size, height: size, marginInline: -(size * 0.18) }}
            >
              <span
                className="rounded-full border-2 border-kraft bg-p3"
                style={{ width: size * 0.52, height: size * 0.52 }}
              />
            </span>
          ))}
        </div>
      ))}
      {/* The sheet ground the bank rests on. */}
      <span className="absolute inset-x-0 bottom-0 h-[10px] bg-p1 shadow-[0_-1px_0_var(--edge)]" />
    </div>
  );
}

function WeekPreview() {
  const rows: readonly {
    readonly title: string;
    readonly course: string;
    readonly due: string;
    readonly bar: string;
  }[] = [
    { title: 'Problem set 4', course: 'Course A', due: '23:59', bar: 'bg-glow-deep' },
    { title: 'Lab report 2', course: 'Course B', due: '17:00', bar: 'bg-glow-deep' },
    { title: 'Draft outline', course: 'Course B', due: 'Wed', bar: 'bg-edge' },
  ];

  return (
    <figure className="relative">
      <span
        aria-hidden="true"
        className="absolute inset-0 translate-x-2 translate-y-2 rounded-sm bg-p1 shadow-lift-0"
      />
      <LayeredCard lift={3} className="relative">
        <figcaption className="flex items-center justify-between gap-3 border-b border-edge-soft px-4 py-2.5">
          <Caption>Your week</Caption>
          <Caption>Section 02</Caption>
        </figcaption>

        <ul className="divide-y divide-edge-soft">
          {rows.map((row) => (
            <li key={row.title} className="relative flex items-center gap-3 py-3 pr-4 pl-5">
              <span aria-hidden="true" className={cx('absolute inset-y-2 left-0 w-[4px]', row.bar)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink">
                  {row.title}
                </span>
                <span className="block truncate text-[11.5px] text-ink-faint">{row.course}</span>
              </span>
              <span className="font-mono text-[13px] text-ink-soft tabular-nums">{row.due}</span>
            </li>
          ))}
        </ul>

        <p className="relative border-t border-edge-soft py-2.5 pr-4 pl-5 text-[12px] text-ink-soft">
          <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[4px] bg-slate" />3 items
          need your call
        </p>
      </LayeredCard>
      <p className="mt-2 text-[11.5px] text-ink-faint">
        Example only. Your actual coursework appears after you connect.
      </p>
    </figure>
  );
}

function Band({
  id,
  tone,
  children,
}: {
  readonly id?: string;
  readonly tone: 'p1' | 'p2';
  readonly children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cx('scroll-mt-20 py-14 lg:py-[60px]', tone === 'p1' ? 'bg-p1' : 'bg-p2')}
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 lg:px-[60px]">{children}</div>
    </section>
  );
}

function SectionHeading({
  number,
  title,
  body,
}: {
  readonly number: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div className="max-w-[420px]">
      <Caption>{number}</Caption>
      <h2 className="mt-2 text-[27px] leading-[1.06] font-bold tracking-[-0.035em] text-ink lg:text-[34px]">
        {title}
      </h2>
      <p className="mt-4 text-[14.5px] leading-[1.65] text-ink-soft">{body}</p>
    </div>
  );
}

function Problem() {
  const stream: readonly { readonly title: string; readonly mine: boolean }[] = [
    { title: 'Section 02 — Problem set 4', mine: true },
    { title: 'Section 05 — Field notes', mine: false },
    { title: 'All sections — Reading response 6', mine: true },
    { title: 'Section 07 — Lab briefing', mine: false },
    { title: 'Section 02 — Seminar prep', mine: true },
    { title: 'Section 04 — Draft outline', mine: false },
  ];

  return (
    <Band id="how-it-works" tone="p1">
      <div className="grid gap-10 lg:grid-cols-[420px_1fr] lg:gap-14">
        <SectionHeading
          number="01"
          title="One Classroom, everybody's coursework."
          body="Teachers post for every section into the same stream. A post for another section looks exactly as urgent as your own, and you should not have to open each one to find out."
        />
        <div className="relative">
          <Annotation rotate={3} className="absolute -top-4 right-2 z-10">
            only 3 of these are yours
          </Annotation>
          <RecessedWell className="p-4">
            <Caption>Classroom stream, unsorted</Caption>
            <ul className="mt-3 flex flex-col gap-2">
              {stream.map((post) => (
                <li
                  key={post.title}
                  className={cx(
                    'rounded-xs px-3 py-2.5 text-[13px]',
                    post.mine
                      ? 'translate-x-1.5 bg-p3 font-medium text-ink shadow-lift-2'
                      : 'bg-p1 text-ink-faint opacity-60 shadow-lift-0',
                  )}
                >
                  {post.title}
                </li>
              ))}
            </ul>
          </RecessedWell>
        </div>
      </div>
    </Band>
  );
}

function Filtering() {
  return (
    <Band tone="p2">
      <div className="grid gap-10 lg:grid-cols-[1fr_420px] lg:gap-14">
        <div>
          <ContourCard className="p-4">
            <Caption>Kept</Caption>
            <ul className="mt-3 flex flex-col gap-2">
              {['Problem set 4 · Section 02', 'Reading response 6 · All sections', 'Seminar prep · Section 02'].map(
                (line) => (
                  <li
                    key={line}
                    className="rounded-xs bg-p3 px-3 py-2.5 text-[13px] font-medium text-ink shadow-lift-1"
                  >
                    {line}
                  </li>
                ),
              )}
            </ul>
          </ContourCard>

          <RecessedWell className="mt-4 p-4">
            <Caption>Set aside</Caption>
            <ul className="mt-3 flex flex-col gap-1.5">
              {['Field notes · Section 05', 'Lab briefing · Section 07'].map((line) => (
                <li key={line} className="px-1 text-[12.5px] text-ink-faint">
                  {line}
                </li>
              ))}
            </ul>
          </RecessedWell>
        </div>

        <div>
          <SectionHeading
            number="02"
            title="Kept, set aside, or asked about."
            body="LockIn reads the section labels a teacher actually wrote. A post naming no section is treated as everyone's, which is usually right. Where the text is ambiguous it is not guessed at — it is put to you."
          />
          <div
            aria-hidden="true"
            className="mt-6 flex h-3 gap-1 overflow-hidden rounded-xs shadow-press"
          >
            <span className="flex-[3] bg-glow-deep" />
            <span className="flex-[3] bg-glow-deep" />
            <span className="flex-[3] bg-glow-deep" />
            <span className="flex-1 bg-slate" />
            <span className="flex-[2] bg-edge" />
            <span className="flex-[2] bg-edge" />
          </div>
          <p className="mt-2 font-mono text-[11.5px] text-ink-faint tabular-nums">
            3 yours · 1 to review · 2 set aside
          </p>
        </div>
      </div>
    </Band>
  );
}

function ReviewSection() {
  return (
    <Band tone="p1">
      <div className="grid gap-10 lg:grid-cols-[420px_1fr] lg:gap-14">
        <SectionHeading
          number="03"
          title="When it cannot tell, it asks."
          body="An ambiguous post is never quietly discarded. It goes to Needs Review with the three plain-language reasons LockIn had, and you decide. No confidence scores — a percentage invites you to argue with a classifier instead of answering the question."
        />
        <div className="relative lg:max-w-[480px] lg:justify-self-end">
          <ContourCard glow className="p-5">
            <div className="flex items-center justify-between gap-3">
              <Caption className="text-slate">Needs review</Caption>
              <span className="font-mono text-[11.5px] text-ink-faint tabular-nums">1 of 3</span>
            </div>
            <h3 className="mt-2 text-[16px] font-bold tracking-[-0.02em] text-ink">Field notes 3</h3>
            <p className="mt-1 text-[12px] text-ink-soft">Course C · shared Classroom</p>
            <RecessedWell className="mt-3 p-3">
              <ul className="flex flex-col gap-1.5 text-[12.5px] leading-snug text-ink-soft">
                <li>Title mentions Section 04</li>
                <li>You are in Section 02</li>
                <li>Posted to everyone, no section tag</li>
              </ul>
            </RecessedWell>
            <div className="mt-4 flex gap-2">
              <PaperButtonLink
                href="/welcome?signin=1"
                variant="primary"
                size="md"
                className="flex-1"
              >
                This is for me
              </PaperButtonLink>
              <PaperButtonLink
                href="/welcome?signin=1"
                variant="secondary"
                size="md"
                className="flex-1"
              >
                Not for me
              </PaperButtonLink>
            </div>
          </ContourCard>
        </div>
      </div>
    </Band>
  );
}

function CoursesAndFreshness() {
  return (
    <Band tone="p2">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <SectionHeading
            number="04"
            title="You choose the subjects."
            body="Google saying you are enrolled is not a reason to track something. Nothing is synchronised or shown until you opt in, and you can drop a course at any time."
          />
          <LayeredCard lift={1} className="mt-6 p-4">
            <ul className="flex flex-col gap-2">
              {[
                { name: 'Course A', section: 'Sec 02', on: true },
                { name: 'Course B', section: 'Sec 07', on: true },
                { name: 'Course D', section: 'archived', on: false },
              ].map((course) => (
                <li
                  key={course.name}
                  className={cx(
                    'flex items-center gap-3 rounded-xs px-3 py-2.5',
                    course.on ? 'bg-p1 shadow-lift-0' : 'bg-p1 opacity-70 shadow-press',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{course.name}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{course.section}</span>
                  <PaperToggle on={course.on} label={`Track ${course.name}`} />
                </li>
              ))}
            </ul>
          </LayeredCard>
        </div>

        <div>
          <SectionHeading
            number="05"
            title="It tells you how current it is."
            body="A sync can fail, and access can expire. LockIn says so on the screen rather than presenting old coursework as if it were today's."
          />
          <div className="mt-6 flex flex-col gap-2">
            <SyncPill tone="moss">Updated 2 min ago</SyncPill>
            <SyncPill tone="glow-deep">Some courses could not sync</SyncPill>
            <SyncPill tone="glow-deep">Showing data from 3 hours ago</SyncPill>
            <SyncPill tone="terra">Google Classroom needs reconnecting</SyncPill>
          </div>
        </div>
      </div>
    </Band>
  );
}

function Privacy() {
  const cards: readonly { readonly title: string; readonly body: string }[] = [
    {
      title: 'Read-only access',
      body: 'Four read-only Classroom permissions. LockIn cannot post, submit, grade or delete anything, because it never asks for permission to.',
    },
    {
      title: 'Coursework only',
      body: 'No roster scope and no profile scope. Grades arrive with the submission data and are discarded before anything is written down.',
    },
    {
      title: 'Disconnect anytime',
      body: 'Disconnecting revokes the grant at Google and removes the stored credentials. Deleting your account removes everything else.',
    },
  ];

  return (
    <Band id="privacy" tone="p1">
      <SectionHeading
        number="06"
        title="It asks for as little as it can."
        body="The permissions are the smallest set that makes the product work, and every one of them is read-only."
      />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <RecessedWell key={card.title} className="p-5">
            <h3 className="text-[16px] font-bold tracking-[-0.02em] text-ink">{card.title}</h3>
            <p className="mt-2 text-[13px] leading-[1.6] text-ink-soft">{card.body}</p>
          </RecessedWell>
        ))}
      </div>
    </Band>
  );
}

function ClosingCta() {
  return (
    <section className="bg-p0 py-14 lg:py-[60px]">
      <div className="mx-auto w-full max-w-[1280px] px-5 lg:px-[60px]">
        <div className="relative isolate rounded-lg bg-p0 p-4 shadow-press lg:p-8">
          <span aria-hidden="true" className="glow-pool" />
          <div className="rounded-sm bg-p2 px-6 py-12 text-center shadow-lift-3 lg:px-10 lg:py-14">
            <h2 className="mx-auto max-w-[22ch] text-[27px] leading-[1.06] font-bold tracking-[-0.035em] text-ink lg:text-[34px]">
              Your Classroom, filtered for your section.
            </h2>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <PaperButtonLink href="/welcome?signin=1" variant="primary" size="lg">
                Continue with Google
              </PaperButtonLink>
              <PaperButtonLink href="/legal/privacy" variant="secondary" size="lg">
                Read the privacy note
              </PaperButtonLink>
            </div>
          </div>
          {/* Two small cut ridges at the base, as if the sheet were resting on
              folded card. */}
          <div aria-hidden="true" className="mx-auto flex w-2/3 justify-between">
            <span className="h-2 w-1/4 rounded-b-sm bg-p1 shadow-lift-0" />
            <span className="h-2 w-1/4 rounded-b-sm bg-p1 shadow-lift-0" />
          </div>
        </div>
      </div>
    </section>
  );
}
