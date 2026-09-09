import type { ReactNode } from 'react';
import Link from 'next/link';

import { SettingsIcon } from '@/components/icons';
import { LogoTile } from '@/components/paper';
import { Footer } from './Footer';
import { PaperBottomNav, PaperSidebarNav } from './PaperNav';

/**
 * The page as a stack of paper.
 *
 * A sand ground, a sidebar cut from the same ground, and the content raised
 * above both as an ivory sheet. The sidebar carries no border and no fill of
 * its own: it *is* the ground, and what separates it from the content is that
 * the content sits on top of it.
 *
 * One content tree, placed by CSS. The phone gets the same sheet with the
 * sidebar dropped and a tab bar anchored to the bottom, rather than a second
 * component rendering the same data a second way.
 */

export interface PaperShellProps {
  readonly title: string;
  /** Mono line beneath the title: the date, the counts. */
  readonly subtitle?: ReactNode;
  readonly reviewCount?: number;
  /** Sits opposite the title — freshness and the sync control. */
  readonly headerAside?: ReactNode;
  /**
   * The context column: a calendar, a cohort picker, a room finder.
   *
   * Given a slot rather than left to each page because the rail has to fold
   * *under* the content on a narrow screen, and a page that laid it out itself
   * would have to re-derive that breakpoint every time.
   */
  readonly rail?: ReactNode;
  readonly children: ReactNode;
}

export function PaperShell({
  title,
  subtitle,
  reviewCount = 0,
  headerAside,
  rail,
  children,
}: PaperShellProps) {
  return (
    <div className="grain min-h-dvh bg-p0" data-skin="paper">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-sm focus:bg-p3 focus:px-4 focus:py-2 focus:shadow-lift-2"
      >
        Skip to content
      </a>

      <div className="mx-auto flex w-full max-w-[1280px]">
        {/* The sidebar is the ground itself, so it gets no surface of its own. */}
        <aside className="sticky top-0 hidden h-dvh w-[214px] shrink-0 flex-col lg:flex">
          <Link
            href="/"
            className="flex min-h-14 items-center gap-2.5 pt-5 pr-3 pb-2 pl-3 focus-visible:paper-focus"
          >
            <LogoTile size={30} />
            <span className="text-[16px] font-bold tracking-[-0.03em] text-ink">LockIn</span>
          </Link>
          <div className="flex min-h-0 flex-1 flex-col">
            <PaperSidebarNav reviewCount={reviewCount} />
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-3 pt-3 pb-24 lg:px-0 lg:pt-5 lg:pr-5 lg:pb-8">
          <main
            id="main-content"
            className="grain rounded-lg bg-p2 px-4 pt-5 pb-8 shadow-lift-2 lg:px-7 lg:pt-6 lg:pb-8"
          >
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="lg:hidden">
                  <LogoTile size={34} />
                </span>
                <div className="min-w-0">
                  <h1 className="text-[20px] font-bold tracking-[-0.035em] text-ink lg:text-[27px]">
                    {title}
                  </h1>
                  {subtitle === undefined ? null : (
                    <p className="mt-0.5 font-mono text-[12px] text-ink-faint tabular-nums">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              {/* Always rendered, because it carries Settings.

                  The sidebar is the only route to Settings and it is hidden
                  below `lg`, so on a phone or a tablet the screen was simply
                  unreachable -- there is no sixth tab, and adding one would put
                  six targets across a 390px bar. The old shell solved this the
                  same way, with a settings control in the header. */}
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {headerAside}
                <Link
                  href="/settings"
                  aria-label="Settings"
                  className="flex size-[38px] shrink-0 items-center justify-center rounded-sm bg-p3 text-ink-soft shadow-lift-1 transition-[box-shadow,color] hover:text-ink hover:shadow-lift-2 focus-visible:paper-focus lg:hidden"
                >
                  <SettingsIcon className="size-[18px]" />
                </Link>
              </div>
            </header>

            {rail === undefined ? (
              children
            ) : (
              <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
                <div className="min-w-0">{children}</div>
                {/* Sticky only once it is a column of its own. Pinned while it
                    is stacked under the content, it would cover the list it is
                    meant to filter. */}
                {/* A hairline, not a second sheet. The rail is part of the same
                    page as the content beside it; putting it on paper of its own
                    would make it read as a panel that had been dropped on top. */}
                <aside
                  aria-label="Context"
                  className="flex min-w-0 flex-col gap-6 border-t border-edge-soft pt-6 xl:sticky xl:top-5 xl:self-start xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6"
                >
                  {rail}
                </aside>
              </div>
            )}
          </main>

          <div className="mt-6 hidden lg:block">
            <Footer inShell />
          </div>
        </div>
      </div>

      <PaperBottomNav reviewCount={reviewCount} />
    </div>
  );
}
