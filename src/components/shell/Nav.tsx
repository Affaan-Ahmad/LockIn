'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { BooksIcon, CalendarIcon, HomeIcon, ReviewIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

/**
 * Primary navigation. Bottom bar on phones, side rail from `md` up.
 *
 * A Client Component for one reason: it needs the current pathname to mark the
 * active item. That is the whole client footprint — the pages it links to stay
 * Server Components, and no page tree becomes a client tree because of this.
 *
 * Four destinations, not five. Settings is reached from the header instead: it
 * is visited rarely, and a fifth icon dilutes the four that matter. Icons are
 * paired with visible labels rather than replacing them, because an icon-only
 * bar makes every user guess.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly Icon: (props: { className?: string }) => ReactNode;
}

const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Today', Icon: HomeIcon },
  { href: '/upcoming', label: 'Upcoming', Icon: CalendarIcon },
  { href: '/courses', label: 'Courses', Icon: BooksIcon },
  { href: '/review', label: 'Review', Icon: ReviewIcon },
];

export interface NavProps {
  /** Shown as a count on Review. Omitted when zero, because a badge of 0 is noise. */
  readonly reviewCount?: number;
}

export function Nav({ reviewCount = 0 }: NavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cx(
        // Fixed bottom bar on phones; a rail on wider screens.
        // Opaque, not translucent. A blurred bar costs a compositor pass on
        // every scroll frame, and over a plain ground it buys nothing you can
        // see. Removing it is faster and looks identical.
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised',
        'md:inset-y-0 md:right-auto md:left-0 md:w-60 md:border-t-0 md:border-r',
        // Home-screen install: the bar must clear the gesture area, or the last
        // item sits under the system indicator and cannot be tapped.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around md:h-full md:max-w-none md:flex-col md:justify-start md:gap-1 md:p-3">
        <div className="hidden md:mb-6 md:flex md:items-center md:px-3 md:pt-3">
          <span className="text-lg font-semibold tracking-[-0.03em] text-ink">LockIn</span>
        </div>

        {ITEMS.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const badge = href === '/review' && reviewCount > 0 ? reviewCount : null;

          return (
            <Link
              key={href}
              href={href}
              // The active item is conveyed to assistive tech here, not by
              // colour alone.
              aria-current={active ? 'page' : undefined}
              className={cx(
                // 44px minimum on every axis.
                'group relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1',
                'rounded-control px-2 py-2 text-2xs font-medium',
                'md:min-h-10 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-base',
                'press',
                // Weight, not just colour, marks the active item. Colour alone
                // disappears in greyscale and for a red-green colour-blind
                // reader; the tint is a reinforcement, not the signal.
                active
                  ? 'font-semibold text-brand md:bg-brand-soft'
                  : 'text-ink-muted hover:text-ink md:hover:bg-sunken',
              )}
            >
              <span className="relative">
                <Icon className={cx('size-[1.35rem]', active ? 'text-brand' : '')} />
                {badge !== null ? (
                  <span
                    className={cx(
                      'absolute -top-1.5 -right-2 min-w-[1.05rem] rounded-pill px-1',
                      'bg-review text-center text-2xs leading-[1.05rem] font-semibold text-white',
                    )}
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                ) : null}
              </span>
              {label}
              {/* Active marker that survives greyscale and forced colours,
                  where the brand tint above disappears entirely. */}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-pill bg-brand md:top-2 md:bottom-2 md:left-0 md:h-auto md:w-0.5 md:translate-x-0"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
