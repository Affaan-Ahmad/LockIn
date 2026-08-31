import Link from 'next/link';

import { LEGAL_PAGES } from '@/app/legal/content';
import { cx } from '@/lib/cx';

/**
 * The legal footer.
 *
 * Reachable from the signed-out screen as well as from inside the app, because
 * the people who most need these pages are the ones deciding whether to sign in
 * at all, and Google's OAuth reviewers, who never will.
 *
 * A Server Component with plain links. Nothing here needs to know the current
 * route, so nothing here needs to ship JavaScript.
 */

export interface FooterProps {
  /** Inside the app the fixed navigation needs clearing; on /welcome it does not. */
  readonly inShell?: boolean;
}

export function Footer({ inShell = false }: FooterProps) {
  return (
    <footer
      className={cx(
        'border-t border-line px-1 pt-6',
        inShell ? 'mt-8' : 'mt-8 px-5 pb-8',
      )}
    >
      <h2 className="text-sm font-semibold text-ink">Legal</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {LEGAL_PAGES.map((page) => (
          <li key={page.href}>
            <Link
              href={page.href}
              className="text-sm font-medium text-brand hover:underline focus-visible:underline"
            >
              {page.title}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        LockIn is an independent project and is not affiliated with Google or any university.
      </p>
    </footer>
  );
}
