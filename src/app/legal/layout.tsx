import type { ReactNode } from 'react';
import Link from 'next/link';

import { LogoTile, PaperNotice } from '@/components/paper';
import { LEGAL_PAGES, LEGAL_STATUS } from './content';

/**
 * The frame every legal page shares.
 *
 * Outside AppShell on purpose. These pages have to be readable by someone who
 * is not signed in, including Google's OAuth reviewers, so they cannot sit
 * behind a navigation bar whose destinations all require a session.
 */
/**
 * Rendered per request, and it has to be.
 *
 * The Content-Security-Policy this app sends is nonce-based, and a nonce only
 * exists if there is a request to mint it for. A statically prerendered page is
 * built once with no request, so its script tags carry no nonce -- while
 * middleware still sends a policy demanding one. `strict-dynamic` then makes it
 * absolute: browsers that honour it ignore `'self'` entirely, so every script on
 * the page is refused and nothing hydrates.
 *
 * Measured on the deployed site before this was added: 38 script tags on the
 * privacy policy, zero nonces, 37 CSP violations, no JavaScript at all. It went
 * unnoticed because static text looks fine without it.
 *
 * The cost is one render per request on a handful of rarely-read pages. The
 * alternative is weakening the policy for everyone, which is a far worse trade.
 */
export const dynamic = 'force-dynamic';

export default function LegalLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grain min-h-dvh bg-p0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="border-b border-edge-soft px-5 py-4">
        <div className="mx-auto flex max-w-[52rem] items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 focus-visible:paper-focus"
          >
            <LogoTile size={28} />
            <span className="text-[16px] font-bold tracking-[-0.03em] text-ink">LockIn</span>
          </Link>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {LEGAL_PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="font-medium text-ink-soft hover:text-ink focus-visible:paper-focus"
              >
                {page.shortTitle}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* The text sits on a sheet of its own, the way every other screen's
          content does. Legal pages are read by people who are not signed in,
          including Google's reviewers, so they are the one part of the product
          a stranger sees first -- looking like a different application is not
          a detail here. */}
      <main className="grain mx-auto mt-6 mb-10 max-w-[52rem] rounded-lg bg-p2 px-5 py-10 shadow-lift-2 sm:px-8">
        {/* Stated at the top of every page rather than buried at the bottom.
            Someone relying on these documents needs to know their status
            before they read them, not after. */}
        <PaperNotice tone="glow-deep" title="About these documents" className="mb-8">
          {LEGAL_STATUS}
        </PaperNotice>
        {children}
      </main>
    </div>
  );
}
