import { Skeleton } from './Skeleton';

/**
 * What a screen looks like while its data is in flight.
 *
 * Shaped like the real list rather than a spinner. Every screen here waits on a
 * round trip to another region, so this is on screen for roughly half a second
 * on a good connection, and a placeholder of the wrong height would cause
 * exactly the layout shift it exists to prevent.
 *
 * No shimmer sweep. A gradient travelling across the page repaints a large area
 * continuously, which is the cost a loading state is supposed to avoid.
 */

export interface PageSkeletonProps {
  /** Roughly how many rows the real screen shows. Kept small; the fold is what matters. */
  readonly rows?: number;
  readonly groups?: number;
}

export function PageSkeleton({ rows = 3, groups = 2 }: PageSkeletonProps) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      {Array.from({ length: groups }, (_, group) => (
        <div key={group}>
          <div className="mb-3 px-0.5">
            <Skeleton variant="line" width="5.5rem" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton variant="card" count={group === 0 ? rows : Math.max(1, rows - 1)} />
          </div>
        </div>
      ))}
    </div>
  );
}
