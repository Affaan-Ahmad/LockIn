import Link from 'next/link';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * A block of secondary context for the desktop rail.
 *
 * Quieter than the assignment list beside it by design: this column exists
 * because a 1440px screen has room for context, not because the context is
 * competing for attention. If a panel here ever looks as important as the work
 * in the main column, the hierarchy has failed.
 *
 * On a phone the shell moves these below the list rather than dropping them, so
 * nothing here is desktop-only information.
 */

export interface RailPanelProps {
  readonly title: string;
  /** The number this panel is about, when it has one. */
  readonly value?: string;
  readonly hint?: string;
  /** Turns the whole panel into a link. Used where the panel is a destination. */
  readonly href?: string;
  readonly tone?: 'neutral' | 'review';
  readonly children?: ReactNode;
}

export function RailPanel({ title, value, hint, href, tone = 'neutral', children }: RailPanelProps) {
  const body = (
    <>
      <p className="text-sm font-medium text-ink">{title}</p>
      {value === undefined ? null : (
        <p
          className={cx(
            'text-base font-semibold',
            tone === 'review' ? 'text-review' : 'text-ink',
          )}
        >
          {value}
        </p>
      )}
      {hint === undefined ? null : <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {children}
    </>
  );

  if (href === undefined) {
    return <section className="surface-flat p-3.5">{body}</section>;
  }

  return (
    <Link
      href={href}
      className="context-link"
    >
      {body}
    </Link>
  );
}
