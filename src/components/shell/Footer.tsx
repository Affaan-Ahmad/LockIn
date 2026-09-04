import Link from 'next/link';

import { CONTROLLER, LEGAL_PAGES } from '@/app/legal/content';
import { LockInMark } from '@/components/icons';
import { cx } from '@/lib/cx';

/**
 * The site footer.
 *
 * It was a stacked list of four links under a heading, which is a sidebar
 * pattern rather than a footer one: it ran down the page spending a column's
 * worth of height on four short strings. A footer is horizontal. The links now
 * sit on one line separated by hairlines, with the attribution opposite them
 * and the copyright on its own rule beneath.
 *
 * Reachable from the signed-out screens as well as inside the app, because the
 * people who most need these pages are the ones deciding whether to sign in at
 * all, plus Google's OAuth reviewers, who never will.
 *
 * A Server Component with plain links: nothing here needs the current route, so
 * nothing here ships JavaScript.
 */

export interface FooterProps {
  /** Inside the app the footer is quieter, and the fixed nav needs clearing. */
  readonly inShell?: boolean;
}

export function Footer({ inShell = false }: FooterProps) {
  return (
    <footer className={cx('border-t border-line', inShell ? 'mt-8 pt-5' : 'mt-8 px-5 pt-6 pb-8')}>
      <div
        className={cx(
          'flex flex-col gap-4',
          // Two ends on anything wider than a phone. Stacked below that,
          // because four links plus a sentence will not share a 390px line.
          'sm:flex-row sm:items-start sm:justify-between sm:gap-8',
        )}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <LockInMark className="size-4 shrink-0" />
            LockIn
          </p>
          <p className="measure mt-1 text-xs leading-relaxed text-ink-muted">
            An independent project. Not affiliated with, endorsed by or sponsored by Google or any
            university.
          </p>
        </div>

        {/* Labelled by the visible heading rather than by aria-label. The
            legal pages also carry a "Legal" nav in their header, and two
            landmarks with the same hidden name is a worse experience than
            either alone; pointing at real text fixes that and avoids stating
            the label twice. */}
        <nav aria-labelledby="footer-legal" className="shrink-0">
          <h2
            id="footer-legal"
            className="text-xs font-bold tracking-[0.04em] text-ink uppercase"
          >
            Legal
          </h2>
          <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {LEGAL_PAGES.map((page, index) => (
              <li key={page.href} className="flex items-center gap-x-3">
                {/* A hairline between links rather than a middle dot. The dot is
                    the separator every generated page reaches for, and at this
                    size a rule reads as structure instead of punctuation. */}
                {index === 0 ? null : <span aria-hidden="true" className="h-3 w-px bg-line" />}
                <Link
                  href={page.href}
                  className="text-xs font-medium text-ink-soft hover:text-ink hover:underline"
                >
                  {page.shortTitle}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <p className="mt-5 border-t border-line pt-4 text-xs text-ink-muted">
        &copy; {new Date().getFullYear()} {CONTROLLER}
      </p>
    </footer>
  );
}
