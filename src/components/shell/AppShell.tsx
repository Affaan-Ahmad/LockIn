import type { ReactNode } from 'react';
import Link from 'next/link';

import { SettingsIcon } from '@/components/icons';
import { Footer } from './Footer';
import { Nav } from './Nav';

/**
 * The application frame: header, content column, navigation.
 *
 * A Server Component. Only `Nav` is a client island, and only because it needs
 * the current pathname. Everything else here renders once on the server.
 *
 * The content column is capped rather than fluid. Cards stretched across a 27"
 * monitor make a deadline harder to read, not easier, and the point of the
 * product is that a student can scan the list in seconds.
 */

export interface AppShellProps {
  readonly title: string;
  /**
   * Optional line under the title. Kept short -- this is not a place for prose.
   *
   * Explicitly `| undefined` so pages can write `cond ? text : undefined`
   * inline. Under exactOptionalPropertyTypes a bare `?:` rejects that, and the
   * workaround is conditional prop spreading, which is far harder to read than
   * the ternary it replaces.
   */
  readonly subtitle?: string | undefined;
  readonly reviewCount?: number;
  /** Freshness, sync controls: rendered by the page, placed by the shell. */
  readonly headerAside?: ReactNode;
  readonly children: ReactNode;
}

export function AppShell({
  title,
  subtitle,
  reviewCount = 0,
  headerAside,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-dvh md:pl-56">
      {/* Skip link. The first tab stop on every page, so a keyboard user is not
          forced through the whole nav to reach the list they came for. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand"
      >
        Skip to content
      </a>

      <header className="px-4 pt-6 pb-2 md:px-8 md:pt-10">
        <div className="mx-auto flex max-w-[var(--content-max)] items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-ink">{title}</h1>
            {subtitle === undefined ? null : (
              <p className="mt-1 text-base text-ink-soft">{subtitle}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {headerAside}
            <Link
              href="/settings"
              aria-label="Settings"
              className="surface-raised press flex size-11 items-center justify-center rounded-pill text-ink-soft active:scale-95 hover:text-ink"
            >
              <SettingsIcon />
            </Link>
          </div>
        </div>
      </header>

      <main
        id="main"
        // Bottom padding clears the fixed nav plus the gesture area, so the last
        // card is never trapped underneath it.
        className="mx-auto max-w-[var(--content-max)] px-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1.5rem)] md:px-8 md:pb-12"
      >
        {children}
        <Footer inShell />
      </main>

      <Nav reviewCount={reviewCount} />
    </div>
  );
}
