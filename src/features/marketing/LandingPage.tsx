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
        <Timetable />
        <YourOwn />
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
              when it is not sure, and shows what is due next — alongside the class timetable your
              university publishes, and whatever you add yourself.
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
 * The paper clouds along the floor of the hero.
 *
 * Cut card, not weather. Each cloud is one silhouette stamped three times at
 * small offsets — a back sheet, a middle, and the face — so the depth comes from
 * the stack rather than from a gradient or a blur. That is the same rule every
 * card on this page follows: a surface sits on a *visible* sheet below it.
 *
 * The three sheets step p0 → p1 → p3, not p1 → p2 → p3. Adjacent sheets are
 * about four points of lightness apart, which is right for a card lying flat on
 * a page and far too little at this scale: stamped three times a few pixels
 * apart it read as one shape with a thick outline. Skipping a step is what makes
 * the stack legible as a stack.
 *
 * Silhouettes are hand-written paths rather than circles. Nested discs read as
 * bubbles, which is exactly what the previous version looked like; a cloud needs
 * bumps of unequal size sitting on a flat cut base.
 *
 * Strokes are `non-scaling-stroke`, so a cloud drawn at 96px and one at 264px
 * share the same cut edge instead of the large one looking inflated.
 *
 * Transform-only, no filters, no animated shadows, six clouds at most. This runs
 * continuously on the page an installed app opens cold.
 */

/**
 * Silhouettes, each with a flat cut base.
 *
 * `mid` is the centre of the viewBox and `mark` is where a doodle hangs. Both
 * are stored per shape because the three viewBoxes are different sizes — the
 * first version reused one set of coordinates for all of them and the doodles
 * landed wherever that happened to fall.
 */
const CLOUD_SHAPES = [
  {
    box: '0 0 200 104',
    d: 'M8 100 C-4 80 8 60 28 65 C31 41 60 30 78 46 C89 24 126 22 137 46 C160 37 187 50 183 72 C199 75 204 100 188 100 Z',
    mid: [100, 52],
    mark: [150, 26],
  },
  {
    box: '0 0 150 88',
    d: 'M6 84 C-3 68 8 52 24 57 C28 34 58 27 71 44 C88 33 111 44 108 62 C124 65 128 84 113 84 Z',
    mid: [75, 44],
    mark: [104, 24],
  },
  {
    box: '0 0 108 68',
    d: 'M5 64 C-2 51 7 39 20 43 C25 24 50 21 58 38 C74 34 85 45 81 60 C92 62 95 64 86 64 Z',
    mid: [54, 34],
    mark: [74, 16],
  },
] as const;

type CloudDoodle = 'curl' | 'wind' | 'star' | 'none';

/**
 * One cloud: three sheets of the same shape, plus an optional pencilled mark.
 *
 * `seed` only varies timing. Giving every cloud the same duration makes a row of
 * them rise and fall in unison, which reads as a loading state rather than as
 * weather.
 */
function PaperCloud({
  shape,
  doodle = 'none',
  seed = 0,
  className,
}: {
  readonly shape: 0 | 1 | 2;
  readonly doodle?: CloudDoodle;
  readonly seed?: number;
  readonly className?: string;
}) {
  const { box, d, mid, mark } = CLOUD_SHAPES[shape];
  const [cx0, cy0] = mid;

  // Scaled about the centre of the shape, not about the origin. `scale()` alone
  // pulls everything toward 0,0, which slid the stitch off the cloud entirely on
  // the wider silhouettes.
  const stitch = `translate(${String(cx0)} ${String(cy0)}) scale(0.9) translate(${String(-cx0)} ${String(-cy0)})`;

  return (
    <span
      className={cx(
        'pointer-events-none absolute motion-safe:animate-[cloud-float_22s_ease-in-out_infinite]',
        className,
      )}
      style={{
        animationDelay: `${String(seed * 1.7)}s`,
        animationDuration: `${String(22 + seed * 3)}s`,
      }}
    >
      <svg viewBox={box} className="h-auto w-full overflow-visible" fill="none" aria-hidden="true">
        {/* The sheet furthest back, offset up and left so it reads as a piece cut
            slightly larger and laid underneath. */}
        <g
          className="motion-safe:animate-[cloud-layer-b_17s_ease-in-out_infinite]"
          style={{ animationDelay: `${String(seed * 0.9)}s` }}
        >
          <path
            d={d}
            transform="translate(-8 -10)"
            fill="var(--p0)"
            stroke="var(--kraft-2)"
            strokeWidth={1.3}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>

        <g
          className="motion-safe:animate-[cloud-layer-a_13s_ease-in-out_infinite]"
          style={{ animationDelay: `${String(seed * 0.6)}s` }}
        >
          <path
            d={d}
            transform="translate(-4 -5)"
            fill="var(--p1)"
            stroke="var(--kraft-2)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>

        {/* The face, and the only layer carrying detail. */}
        <path
          d={d}
          fill="var(--p3)"
          stroke="var(--kraft-2)"
          strokeWidth={1.9}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Thread just inside the cut edge. Dashed rather than solid so it reads
            as stitching instead of a second outline. */}
        <path
          d={d}
          transform={stitch}
          fill="none"
          stroke="var(--kraft)"
          strokeWidth={1}
          strokeDasharray="3 5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.75}
        />

        {doodle === 'none' ? null : (
          <CloudDoodleMark kind={doodle} seed={seed} at={[mark[0], mark[1]]} />
        )}
      </svg>
    </span>
  );
}

/**
 * The pencilled accents, drawn around their own origin and translated into
 * place, so one definition serves all three silhouettes.
 *
 * Kraft, not ink. These are marks on the paper rather than information, and at
 * ink weight they would compete with the copy above them.
 */
function CloudDoodleMark({
  kind,
  seed,
  at,
}: {
  readonly kind: CloudDoodle;
  readonly seed: number;
  readonly at: readonly [number, number];
}) {
  const pen = {
    fill: 'none' as const,
    stroke: 'var(--kraft-3)',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  // Two groups, not one. A CSS `transform` animation on an SVG element replaces
  // that element's `transform` attribute rather than composing with it, so
  // putting the breathe animation and the positioning translate on the same <g>
  // meant the scale silently discarded the translate and every doodle collapsed
  // toward the origin. The outer group places it; the inner one animates.
  //
  // `transform-box: fill-box` makes `transform-origin: center` mean the mark's
  // own centre rather than the corner of the whole viewBox.
  return (
    <g opacity={0.8} transform={`translate(${String(at[0])} ${String(at[1])})`}>
      <g
        className="motion-safe:animate-[doodle-breathe_9s_ease-in-out_infinite]"
        style={{
          animationDelay: `${String(seed * 1.3)}s`,
          transformBox: 'fill-box',
          transformOrigin: 'center',
        }}
      >
      {kind === 'curl' ? (
        // A shaving of paper lifting off the edge: opened out, then tightening
        // into the centre. The first attempt was small enough to read as a
        // stray lowercase o.
        <path
          d="M-2 14 c-4 -9 3 -18 12 -17 c8 1 12 9 8 15 c-3 5 -11 5 -13 -1 c-2 -5 4 -9 8 -5"
          strokeWidth={1.5}
          {...pen}
        />
      ) : null}

      {kind === 'wind' ? (
        // Three trailing strokes with hooked ends, the way wind is drawn by hand.
        <>
          <path d="M0 0 h20 a4 4 0 1 0 -4 -5" strokeWidth={1.5} {...pen} />
          <path d="M-6 9 h26" strokeWidth={1.3} {...pen} />
          <path d="M2 18 h13 a3.5 3.5 0 1 1 -3 4" strokeWidth={1.3} {...pen} />
        </>
      ) : null}

      {kind === 'star' ? (
        // Four-point sparkles as outlines. A filled star at this size is a dot.
        <>
          <path
            d="M0 0 c0 5.4 1.8 7.2 7.2 7.2 c-5.4 0 -7.2 1.8 -7.2 7.2 c0 -5.4 -1.8 -7.2 -7.2 -7.2 c5.4 0 7.2 -1.8 7.2 -7.2 z"
            strokeWidth={1.4}
            {...pen}
          />
          <path
            d="M17 12 c0 3.4 1.1 4.5 4.5 4.5 c-3.4 0 -4.5 1.1 -4.5 4.5 c0 -3.4 -1.1 -4.5 -4.5 -4.5 c3.4 0 4.5 -1.1 4.5 -4.5 z"
            strokeWidth={1.2}
            {...pen}
          />
          </>
        ) : null}
      </g>
    </g>
  );
}

/**
 * The bank itself.
 *
 * A floor band beneath the hero content and never behind it. The clouds are the
 * horizon this section stands on, and a decorative path crossing a heading is
 * the one thing here that would cost readability.
 *
 * Heights are staggered rather than even, and the two largest run off the left
 * and right edges, so the bank reads as a longer row continuing past the card
 * instead of six ornaments laid out in a line.
 *
 * Three of the six are hidden below `sm`. A phone gets fewer clouds at close to
 * the same scale rather than six squashed ones, which is what keeps the top edge
 * of the bank ragged instead of crowded.
 */
function CloudBank() {
  return (
    <div aria-hidden="true" className="relative h-[124px] overflow-hidden sm:h-[156px] lg:h-[188px]">
      <PaperCloud shape={0} doodle="wind" seed={0} className="-left-[5%] bottom-[26px] w-[190px] sm:w-[224px] lg:w-[268px]" />
      <PaperCloud shape={2} doodle="curl" seed={5} className="bottom-[10px] left-[16%] hidden w-[84px] sm:block lg:w-[96px]" />
      <PaperCloud shape={2} doodle="star" seed={1} className="bottom-[64px] left-[29%] hidden w-[100px] sm:block lg:w-[118px]" />
      <PaperCloud shape={1} doodle="curl" seed={2} className="bottom-[18px] left-[41%] w-[152px] sm:w-[180px] lg:w-[210px]" />
      <PaperCloud shape={2} seed={3} className="bottom-[72px] left-[65%] hidden w-[88px] lg:block lg:w-[104px]" />
      <PaperCloud shape={0} doodle="star" seed={4} className="-right-[7%] bottom-[30px] w-[178px] sm:w-[212px] lg:w-[252px]" />

      {/* The shelf the bank stands on, and the reason every silhouette has a flat
          base: these are cut pieces standing up, not floating. */}
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
    { title: 'Problem set 4', course: 'Course A', due: '23:59', bar: 'bg-kraft-2' },
    { title: 'Lab report 2', course: 'Course B', due: '17:00', bar: 'bg-kraft-2' },
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
            <span className="flex-[3] bg-kraft-2" />
            <span className="flex-[3] bg-kraft-2" />
            <span className="flex-[3] bg-kraft-2" />
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
          <ContourCard className="p-5">
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

function Timetable() {
  const day: readonly { readonly time: string; readonly name: string; readonly room: string }[] = [
    { time: '08:30–09:50', name: 'Operating Systems', room: 'C-301' },
    { time: '10:00–11:20', name: 'Database Systems', room: 'C-409' },
    { time: '11:30–13:30', name: 'OS Lab', room: 'Lab 4' },
  ];

  return (
    <Band tone="p1">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <SectionHeading
            number="06"
            title="The timetable, without the spreadsheet."
            body="Your university publishes one enormous sheet for every programme and intake. LockIn reads it and shows the classes for your cohort and section — so a rescheduled class reaches you without anybody re-typing it."
          />
          <LayeredCard lift={2} className="mt-6 overflow-hidden">
            <ul className="divide-y divide-edge-soft">
              {day.map((entry) => (
                <li key={entry.name} className="flex items-baseline gap-3 px-4 py-3">
                  <span className="shrink-0 font-mono text-[12px] text-ink-soft tabular-nums">
                    {entry.time}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                    {entry.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-ink-faint">
                    {entry.room}
                  </span>
                </li>
              ))}
            </ul>
          </LayeredCard>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Read from the university&rsquo;s own document, not from your Google account.
          </p>
        </div>

        <div>
          <SectionHeading
            number="07"
            title="And somewhere to sit."
            body="Which rooms have nothing in them for the next half hour, hour or two hours, answered from the campus clock. A room whose entry could not be read is reported as unaccounted for rather than counted as empty — sending you to an occupied room is the one mistake this must not make."
          />
          <div className="mt-6 flex flex-wrap gap-2">
            {['C-204', 'C-310', 'Lab 2', 'D-101', 'C-407'].map((room) => (
              <span
                key={room}
                className="rounded-xs bg-p3 px-3 py-2 font-mono text-[12px] text-ink shadow-lift-1"
              >
                {room}
              </span>
            ))}
            <span className="rounded-xs bg-p1 px-3 py-2 font-mono text-[12px] text-ink-faint shadow-press">
              2 unaccounted for
            </span>
          </div>
        </div>
      </div>
    </Band>
  );
}

function YourOwn() {
  return (
    <Band tone="p2">
      <div className="grid gap-10 lg:grid-cols-[420px_1fr] lg:gap-14">
        <SectionHeading
          number="08"
          title="Room for what Classroom does not know."
          body="A quiz announced out loud and never posted is still a quiz. Add it yourself and it sits on the calendar beside the published deadlines — marked as yours, because one of them is authoritative and the other is a reminder you set. Work you have handed in keeps a note of its own."
        />
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-sm bg-p3 py-3 pr-4 pl-5 shadow-lift-1">
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px] bg-slate" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                Data Structures quiz 2
              </span>
              <span className="rounded-xs bg-p1 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft shadow-lift-0">
                Quiz
              </span>
              <span className="ml-auto font-mono text-[12px] text-ink tabular-nums">Fri 09:00</span>
            </div>
            <p className="mt-1 text-[12px] text-ink-soft">Chapters 4 to 6, in the lab</p>
          </div>

          <div className="relative overflow-hidden rounded-sm bg-p3 py-3 pr-4 pl-5 shadow-lift-1">
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[4px] bg-moss" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                Problem set 3
              </span>
              <PaperBadge className="shrink-0">Handed in</PaperBadge>
            </div>
            <p className="mt-1.5 text-[12px] text-ink-soft">
              Submitted the extra credit too — ask about question 5.
            </p>
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
        number="09"
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
