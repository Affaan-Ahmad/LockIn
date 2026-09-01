import type { ReactNode } from 'react';
import Link from 'next/link';

import { SettingsIcon } from '@/components/icons';
import { Footer } from './Footer';
import { Nav } from './Nav';
import { SidebarNav } from './SidebarNav';

/**
 * The application frame, in two compositions.
 *
 * Both are rendered and one is hidden by CSS. That is deliberate, and it is the
 * only mechanism that works here: a Server Component cannot know the viewport,
 * so any JavaScript-driven choice would paint the wrong shell first and swap
 * after hydration. CSS decides before the first paint and never flickers.
 *
 * The cost is one duplicated navigation in the markup. That is acceptable
 * precisely because there is exactly one of it. The assignment list, where the
 * same trick would duplicate fifty items, uses a single tree that reflows
 * instead -- see AssignmentItem.
 *
 * The two shells are genuinely different, not one reshaped by breakpoints:
 *
 *   Phone    below 768px: compact header, content column, bottom tab bar,
 *            safe-area insets.
 *   Tablet    768px and up: the web shell with an icon-only sidebar. A tablet
 *            is badly served by a phone layout on a screen that fits
 *            persistent navigation.
 *   Desktop  1024px and up: sidebar labels appear, and a right rail at 1280px.
 *
 * `data-density="pointer"` on the web shell retunes control heights, padding
 * and radii for a mouse. It is a scope rather than a breakpoint so the tokens
 * follow a component wherever it is composed.
 */

export interface AppShellProps {
  readonly title: string;
  /** Optional line under the title. Kept short -- this is not a place for prose. */
  readonly subtitle?: string | undefined;
  readonly reviewCount?: number;
  /** Freshness, sync controls: rendered by the page, placed by the shell. */
  readonly headerAside?: ReactNode;
  /**
   * Secondary context for wide screens: needs-review, sync state, course
   * counts. Never the only place something appears -- a narrow screen drops
   * this column entirely, so anything essential belongs in `children`.
   */
  readonly rail?: ReactNode;
  readonly children: ReactNode;
}

export function AppShell({
  title,
  subtitle,
  reviewCount = 0,
  headerAside,
  rail,
  children,
}: AppShellProps) {
  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Phone                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="min-h-dvh md:hidden">
        <a
          href="#main-touch"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand"
        >
          Skip to content
        </a>

        <header className="px-4 pt-6 pb-4">
          <div className="mx-auto flex max-w-[var(--content-max)] items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold text-ink">{title}</h1>
              {subtitle === undefined ? null : (
                <p className="measure mt-1 text-sm text-ink-soft">{subtitle}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAside}
              <Link
                href="/settings"
                aria-label="Settings"
                className="surface-raised press flex size-11 items-center justify-center rounded-pill text-ink-soft hover:text-ink active:translate-y-px"
              >
                <SettingsIcon />
              </Link>
            </div>
          </div>
        </header>

        <main
          id="main-touch"
          // Bottom padding clears the fixed tab bar plus the gesture area, so
          // the last card is never trapped underneath it.
          className="mx-auto max-w-[var(--content-max)] px-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1.5rem)]"
        >
          {children}
          {/* The rail's contents are not dropped on a phone, only relocated:
              they follow the main list instead of sitting beside it. */}
          {rail === undefined ? null : <div className="mt-8 flex flex-col gap-3">{rail}</div>}
          <Footer inShell />
        </main>

        <Nav reviewCount={reviewCount} />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Tablet and desktop                                               */}
      {/* ---------------------------------------------------------------- */}
      {/* From 768px up. A tablet has room for persistent navigation and is
          badly served by a phone layout on a screen that fits a sidebar; it
          gets the icon-only rail, and the labels arrive at 1024px where there
          is width to spend on them. */}
      <div
        data-density="pointer"
        className="hidden min-h-dvh md:grid md:grid-cols-[var(--sidebar-w-compact)_minmax(0,1fr)] lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]"
      >
        <a
          href="#main-pointer"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand"
        >
          Skip to content
        </a>

        <aside className="sticky top-0 h-dvh border-r border-line bg-raised">
          <SidebarNav reviewCount={reviewCount} />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-line bg-ground/95 px-5 py-3.5 backdrop-blur-[2px] lg:px-8">
            <div className="mx-auto flex max-w-[var(--app-max)] items-center justify-between gap-6">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
                {subtitle === undefined ? null : (
                  <p className="measure truncate text-xs text-ink-muted">{subtitle}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">{headerAside}</div>
            </div>
          </header>

          <main id="main-pointer" className="mx-auto max-w-[var(--app-max)] px-5 py-6 lg:px-8 lg:py-7">
            <div
              className={
                rail === undefined
                  ? 'min-w-0'
                  : 'grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_var(--rail-w)]'
              }
            >
              <div className="min-w-0">{children}</div>
              {rail === undefined ? null : (
                // Below xl the rail wraps under the content rather than
                // squeezing it. Two 400px columns are worse than one 800px one.
                <aside className="flex min-w-0 flex-col gap-3">{rail}</aside>
              )}
            </div>
            <Footer inShell />
          </main>
        </div>
      </div>
    </>
  );
}
