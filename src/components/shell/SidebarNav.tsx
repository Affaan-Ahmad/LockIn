'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  BooksIcon,
  CalendarIcon,
  HomeIcon,
  LockInMark,
  ReviewIcon,
  SettingsIcon,
} from '@/components/icons';
import { cx } from '@/lib/cx';

/**
 * Desktop navigation.
 *
 * A sidebar designed as one, rather than the bottom tab bar reshaped by
 * breakpoint overrides. That is what the previous single component did, and it
 * inherited tab geometry the whole way up: icons stacked over labels, 52px
 * rows, pill hit areas sized for a thumb. Read on a monitor it looked like a
 * phone control that had been stretched.
 *
 * Rows here are 34px, icon beside label, aligned to a single left edge. Settings
 * sits at the foot rather than in the header, because on desktop there is room
 * for it to be a destination rather than a hidden affordance.
 *
 * Client only for `usePathname`. Everything it wraps stays a Server Component.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly Icon: (props: { className?: string }) => ReactNode;
}

const PRIMARY: readonly NavItem[] = [
  { href: '/', label: 'Today', Icon: HomeIcon },
  { href: '/upcoming', label: 'Upcoming', Icon: CalendarIcon },
  { href: '/courses', label: 'Courses', Icon: BooksIcon },
  { href: '/review', label: 'Review', Icon: ReviewIcon },
];

export interface SidebarNavProps {
  readonly reviewCount?: number;
}

export function SidebarNav({ reviewCount = 0 }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      // Icon-only until there is width for labels. One component either way:
      // a second "compact sidebar" would be the same links with the text
      // removed, which is what a CSS variant is for.
      className="flex h-full flex-col gap-1 px-2 py-4 lg:px-3"
    >
      <div className="mb-5 flex items-center gap-2 px-2 max-lg:justify-center">
        {/* The mark, not a typed "L". It is the same geometry as the app icon,
            so a tablet running LockIn beside its own home-screen icon shows one
            identity rather than two things that merely start with the same
            letter. It inherits --ink, so it flips with the theme by itself. */}
        <LockInMark className="size-[1.35rem] shrink-0 text-ink" />
        <span className="hidden text-base font-semibold tracking-[-0.03em] text-ink lg:inline">
          LockIn
        </span>
      </div>

      {PRIMARY.map((item) => (
        <Row
          key={item.href}
          item={item}
          pathname={pathname}
          badge={item.href === '/review' && reviewCount > 0 ? reviewCount : null}
        />
      ))}

      <div className="mt-auto border-t border-line pt-2">
        <Row
          item={{ href: '/settings', label: 'Settings', Icon: SettingsIcon }}
          pathname={pathname}
          badge={null}
        />
      </div>
    </nav>
  );
}

function Row({
  item,
  pathname,
  badge,
}: {
  readonly item: NavItem;
  readonly pathname: string;
  readonly badge: number | null;
}) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={cx(
        'group relative flex h-[2.125rem] items-center gap-2.5 rounded-control',
        'justify-center px-0 lg:justify-start lg:px-2',
        'text-sm transition-colors duration-[120ms]',
        // Weight as well as colour. In greyscale or forced colours the tint
        // vanishes and the active row must still be identifiable.
        active ? 'bg-brand-soft font-semibold text-brand-ink' : 'font-medium text-ink-soft hover:bg-sunken hover:text-ink',
      )}
    >
      <item.Icon className={cx('size-[1.125rem] shrink-0', active ? 'text-brand-ink' : '')} />
      {/* sr-only rather than hidden when compact: the label is still the
          accessible name, so a screen reader reads "Upcoming" and not an
          unlabelled link. */}
      <span className="truncate max-lg:sr-only">{item.label}</span>
      {badge === null ? null : (
        <span className="absolute top-1 right-1 rounded-pill bg-review px-1 text-2xs font-semibold text-white lg:static lg:ml-auto lg:px-1.5">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}
