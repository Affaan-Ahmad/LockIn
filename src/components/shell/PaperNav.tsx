'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  BooksIcon,
  CalendarIcon,
  HomeIcon,
  ReviewIcon,
  SettingsIcon,
  TimetableIcon,
} from '@/components/icons';
import { cx } from '@/lib/cx';

/**
 * Navigation, cut from the same stock as the page.
 *
 * On a desktop the active item is not a highlighted row — it is a cardstock
 * sheet pushed three pixels to the right, square on its right edge, with a
 * strip of kraft along the bottom. It reads as the top sheet of the stack, and
 * because it is flush with the content panel beside it the two look like one
 * continuous piece of paper. That is the whole trick of the sidebar; a tinted
 * pill in the same place would just be a menu.
 *
 * Client only for `usePathname`. Everything it wraps stays a Server Component.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly Icon: (props: { className?: string }) => ReactNode;
}

const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Today', Icon: HomeIcon },
  { href: '/upcoming', label: 'Upcoming', Icon: CalendarIcon },
  { href: '/timetable', label: 'Timetable', Icon: TimetableIcon },
  { href: '/courses', label: 'Courses', Icon: BooksIcon },
  { href: '/review', label: 'Review', Icon: ReviewIcon },
];

const isActive = (href: string, pathname: string): boolean =>
  href === '/' ? pathname === '/' : pathname.startsWith(href);

export interface PaperNavProps {
  readonly reviewCount?: number;
}

export function PaperSidebarNav({ reviewCount = 0 }: PaperNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 pt-4 pr-0 pb-4 pl-3">
      {ITEMS.map((item) => (
        <SidebarRow
          key={item.href}
          item={item}
          active={isActive(item.href, pathname)}
          badge={item.href === '/review' && reviewCount > 0 ? reviewCount : null}
        />
      ))}

      <div className="mt-auto pt-2">
        <SidebarRow
          item={{ href: '/settings', label: 'Settings', Icon: SettingsIcon }}
          active={isActive('/settings', pathname)}
          badge={null}
        />
      </div>
    </nav>
  );
}

function SidebarRow({
  item,
  active,
  badge,
}: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly badge: number | null;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex min-h-11 items-center gap-2.5 rounded-l-sm rounded-r-none px-3 text-[13.5px]',
        'transition-[transform,box-shadow,background-color] duration-[180ms]',
        active
          ? 'translate-x-[3px] bg-p3 font-semibold text-ink shadow-lift-2'
          : 'bg-transparent font-medium text-ink-soft shadow-lift-0 hover:translate-x-[3px] hover:bg-p1 hover:text-ink hover:shadow-lift-1',
        'focus-visible:paper-focus motion-reduce:transform-none motion-reduce:transition-none',
      )}
    >
      <item.Icon className={cx('size-[18px] shrink-0', active ? 'text-kraft-3' : '')} />
      <span className="truncate">{item.label}</span>
      {badge === null ? null : (
        <span className="ml-auto rounded-xs bg-slate px-1.5 text-[11px] font-semibold text-on-fill tabular-nums">
          {badge}
        </span>
      )}
      {active ? (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-kraft-2" />
      ) : null}
    </Link>
  );
}

/**
 * The phone bar: four tabs plus Timetable, each a trimmed paper tab.
 *
 * Anchored to the bottom and padded for the gesture area, because on an
 * installed home-screen app the last item otherwise sits under the system
 * indicator and cannot be tapped at all.
 */
export function PaperBottomNav({ reviewCount = 0 }: PaperNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="inset-safe-bottom inset-safe-x fixed inset-x-0 bottom-0 z-40 bg-p0 shadow-[0_-1px_0_var(--edge-soft)] lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-end justify-around gap-1 px-2 pt-2">
        {ITEMS.map((item) => {
          const active = isActive(item.href, pathname);
          const badge = item.href === '/review' && reviewCount > 0 ? reviewCount : null;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'paper-tab relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 px-1 pb-1',
                'text-[10.5px] transition-all duration-[160ms]',
                active
                  ? '-translate-y-[3px] bg-p3 font-semibold text-ink shadow-lift-2'
                  : 'bg-p1 font-medium text-ink-soft shadow-lift-0',
                'focus-visible:paper-focus motion-reduce:transform-none motion-reduce:transition-none',
              )}
            >
              <span className="relative">
                <item.Icon className={cx('size-[19px]', active ? 'text-kraft-3' : '')} />
                {badge === null ? null : (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] rounded-xs bg-slate px-1 text-center text-[10px] leading-4 font-semibold text-on-fill tabular-nums">
                    {badge}
                  </span>
                )}
              </span>
              <span className="truncate">{item.label}</span>
              {active ? (
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-kraft-2" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
