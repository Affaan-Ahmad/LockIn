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
 *
 * Every tone is the same parchment chip; what changes is the ink and a 3px
 * marker down its leading edge. Six differently tinted fills on one card is a
 * paint chart, they all collapse to the same grey in forced colours, and the
 * soft red one competed with the terra strip that actually means "late". Red is
 * late, and nothing else in this system is red.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'review';

/**
 * Ink and marker per tone, both measured rather than chosen by eye.
 *
 * **Ink** must clear 4.5:1 on the parchment chip. Four values do -- ink-soft at
 * 5.92, slate at 5.38, kraft-3 and terra at 4.62. Moss does not (4.41), so
 * `success` sets its label in plain secondary ink and lets the marker carry the
 * hue.
 *
 * **The marker** is a 3px bar, and a bar nobody can see is not a quieter signal
 * but dead pixels. Three tones therefore have none: on this chip `edge` reaches
 * 1.91:1 and `glow-deep` only 1.47:1. The glow especially is not a near miss --
 * it is the palette's one colour that exists to be *light in a gap*, blurred and
 * under a forward sheet, and pressing it into a hard 3px edge is exactly the
 * misuse `tests/unit/palette-contrast.test.ts` was written to catch.
 *
 * Nothing is lost by dropping them. Every chip says its state in words, and in
 * the deadline list the row it sits on already carries the same urgency in its
 * own cut edge. The marker was only ever the third telling.
 */
const TONE: Record<BadgeTone, string> = {
  neutral: 'text-ink-soft',
  brand: 'text-kraft-3 before:bg-kraft-3',
  success: 'text-ink-soft before:bg-moss',
  warning: 'text-ink-soft',
  danger: 'text-terra before:bg-terra',
  review: 'text-slate before:bg-slate',
};

/**
 * The workbench's chip is a tinted fill with a matching ink, which is the
 * idiom that design uses everywhere and the reason its `*-soft` pairs exist.
 * Restored here rather than approximated, because a grey chip with a coloured
 * edge is paper's device and would read as paper wearing the wrong colours.
 *
 * These fills were measured when they were written: each `*-soft` ground was
 * chosen against its own ink, which is why the tones keep their own text colour
 * here where paper cannot give two of them one.
 */
const WORKBENCH_TONE: Record<BadgeTone, string> = {
  neutral: 'workbench:bg-sunken workbench:text-ink-soft workbench:border-line',
  brand: 'workbench:bg-brand-soft workbench:text-brand-ink workbench:border-transparent',
  success: 'workbench:bg-success-soft workbench:text-success workbench:border-transparent',
  warning: 'workbench:bg-warning-soft workbench:text-warning workbench:border-transparent',
  danger: 'workbench:bg-danger-soft workbench:text-danger workbench:border-transparent',
  review: 'workbench:bg-review-soft workbench:text-review workbench:border-transparent',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={cx(
        // Cut, not moulded. At this height a full pill reads as a toy, and a
        // 2px corner is the same cut as every other sheet on the screen.
        'relative inline-flex items-center overflow-hidden rounded-xs bg-p1 py-0.5 pr-2 pl-2.5',
        'shadow-lift-0',
        // The marker, not a border: 3px down the leading edge only. Painted
        // only when the tone supplies a colour for it -- `before:bg-*` is what
        // switches it on, so a tone with no visible marker simply has none.
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-transparent before:content-['']",
        // Medium rather than semibold. The chip already separates itself from
        // the text around it; weight on top of that made a piece of secondary
        // metadata shout louder than the title.
        'text-[11px] font-medium whitespace-nowrap',
        // The marker is paper's; the workbench states the tone in the fill.
        'workbench:rounded-sm workbench:border workbench:px-2 workbench:text-xs',
        'workbench:shadow-none workbench:before:content-none',
        TONE[tone],
        WORKBENCH_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}
