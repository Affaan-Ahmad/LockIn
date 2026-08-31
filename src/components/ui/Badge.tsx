import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * A status pill.
 *
 * Tone sets the colour; the label carries the meaning. Both are required — a
 * badge that speaks only through colour is invisible to a colour-blind reader
 * and to anyone printing the page.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'review';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink-soft border-line',
  brand: 'bg-brand-soft text-brand border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  review: 'bg-review-soft text-review border-transparent',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  /** Adds a filled dot. Useful when the badge sits among plain text. */
  readonly dot?: boolean;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5',
        'text-xs font-semibold tracking-[0.01em] whitespace-nowrap',
        TONE[tone],
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
