import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * A status chip.
 *
 * Tone sets the colour; the label carries the meaning. Both are required: a
 * chip that speaks only through colour is invisible to a colour-blind reader
 * and to anyone printing the page.
 *
 * Reserved for genuinely categorical state. A chip earns its place when the
 * value is one of a small closed set the student must recognise at a glance --
 * Overdue, Submitted, Check this. Wrapping a course name or a timestamp in the
 * same shape turns the shape into decoration, and once every card carries three
 * of them none of them registers.
 *
 * The optional dot is gone. A coloured dot in front of the word "Overdue" is
 * the word said twice, and a row of them down a list is the most tired signal
 * in interface design.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'review';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink-soft border-line',
  brand: 'bg-brand-soft text-brand-ink border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  review: 'bg-review-soft text-review border-transparent',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={cx(
        // A small radius, not a pill. At this height a full pill reads as a
        // toy, and the softened rectangle echoes the card it sits on.
        'inline-flex items-center rounded-sm border px-2 py-0.5',
        // Medium rather than semibold. The chip already separates itself from
        // the text around it with a fill and a border; weight on top of that
        // made a piece of secondary metadata shout louder than the title.
        'text-xs font-medium whitespace-nowrap',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}
