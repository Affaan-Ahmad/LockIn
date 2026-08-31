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
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised/95 backdrop-blur-[2px]',
        'md:inset-y-0 md:right-auto md:left-0 md:w-56 md:border-t-0 md:border-r md:backdrop-blur-none',
        // Home-screen install: the bar must clear the gesture area, or the last
        // item sits under the system indicator and cannot be tapped.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around md:h-full md:max-w-none md:flex-col md:justify-start md:gap-1 md:p-3">
        <div className="hidden md:mb-4 md:flex md:items-center md:gap-2 md:px-3 md:pt-2">
          <span className="text-[1.0625rem] font-bold tracking-[-0.03em] text-ink">LockIn</span>
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
                'rounded-control px-2 py-2 text-[0.6875rem] font-semibold',
                'md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-[0.9375rem]',
                'press active:scale-[0.97]',
                active
                  ? 'text-brand md:bg-brand-soft'
                  : 'text-ink-muted hover:text-ink md:hover:bg-sunken',
              )}
            >
              <span className="relative">
                <Icon className={cx('size-[1.35rem]', active ? 'text-brand' : '')} />
                {badge !== null ? (
                  <span
                    className={cx(
                      'absolute -top-1.5 -right-2 min-w-[1.05rem] rounded-pill px-1',
                      'bg-review text-center text-[0.625rem] leading-[1.05rem] font-bold text-white',
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
                  className="absolute inset-x-3 top-0 h-0.5 rounded-pill bg-brand md:inset-x-auto md:top-2 md:bottom-2 md:left-0 md:h-auto md:w-0.5"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
