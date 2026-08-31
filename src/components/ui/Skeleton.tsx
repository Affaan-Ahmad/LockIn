import { cx, s } from '@/lib/cx';

import styles from './Skeleton.module.css';

/**
 * A loading placeholder sized like the thing it replaces.
 *
 * Matching the real height is the point: a skeleton that is the wrong size
 * causes exactly the layout shift it was meant to prevent.
 */

export interface SkeletonProps {
  readonly variant?: 'card' | 'line';
  readonly width?: string;
  readonly count?: number;
}

export function Skeleton({ variant = 'line', width, count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cx(s(styles, 'skeleton'), s(styles, variant))}
          style={width === undefined ? undefined : { width }}
          // One label for the group, not one per bar, or a screen reader
          // announces "loading" five times.
          aria-hidden="true"
        />
      ))}
    </>
  );
}
