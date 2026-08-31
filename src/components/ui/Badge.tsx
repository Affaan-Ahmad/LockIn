import type { ReactNode } from 'react';

import { cx, s } from '@/lib/cx';

import styles from './Badge.module.css';

/**
 * A status pill.
 *
 * Tone sets the colour; the label carries the meaning. Both are required --
 * a badge that says something only through its colour is invisible to a
 * colour-blind reader and to anyone printing the page.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'review';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  /** Adds a filled dot. Useful when the badge sits among plain text. */
  readonly dot?: boolean;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span className={cx(s(styles, 'badge'), s(styles, tone))}>
      {dot ? <span className={s(styles, 'dot')} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
