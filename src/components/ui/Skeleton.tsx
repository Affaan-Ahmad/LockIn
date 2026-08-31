import { cx } from '@/lib/cx';

/**
 * A loading placeholder sized like the thing it replaces.
 *
 * Matching the real height is the point: a skeleton of the wrong size causes
 * exactly the layout shift it exists to prevent.
 *
 * A single opacity pulse, not a gradient sweep. Animating a wide gradient
 * across the page repaints a large area continuously, which is the cost a
 * loading state is meant to avoid.
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
          // One label for the group, not one per bar, or a screen reader
          // announces "loading" five times.
          aria-hidden="true"
          style={width === undefined ? undefined : { width }}
          className={cx(
            'animate-pulse bg-sunken',
            // Matches the real card: face plus well. A placeholder of the
            // wrong height causes exactly the shift it exists to prevent.
            variant === 'card' ? 'h-[6.5rem] rounded-card' : 'h-[0.8em] rounded-xs',
          )}
        />
      ))}
    </>
  );
}
