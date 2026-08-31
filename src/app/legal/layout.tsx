import type { ReactNode } from 'react';
import Link from 'next/link';

import { LEGAL_PAGES, LEGAL_STATUS } from './content';

/**
 * The frame every legal page shares.
 *
 * Outside AppShell on purpose. These pages have to be readable by someone who
 * is not signed in, including Google's OAuth reviewers, so they cannot sit
 * behind a navigation bar whose destinations all require a session.
 */
export default function LegalLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line px-5 py-4">
        <div className="mx-auto flex max-w-[52rem] items-center justify-between gap-3">
          <Link href="/" className="text-lg font-semibold tracking-[-0.02em] text-ink">
            LockIn
          </Link>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {LEGAL_PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="font-medium text-ink-soft hover:text-ink"
              >
                {page.shortTitle}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[52rem] px-5 py-10">
        {/* Stated at the top of every page rather than buried at the bottom.
            Someone relying on these documents needs to know their status
            before they read them, not after. */}
        <p
          role="note"
          className="surface-flat measure mb-8 border-warning/35 bg-warning-soft p-3.5 text-sm text-ink"
        >
          {LEGAL_STATUS}
        </p>
        {children}
      </main>
    </div>
  );
}
