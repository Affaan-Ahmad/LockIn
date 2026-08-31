import { AlertIcon, ClockIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { formatAge } from '@/lib/format';
import type { FreshnessView } from '@/lib/queries';

import { FRESHNESS } from '@/features/assignments/presentation';

/**
 * How current the data is.
 *
 * Never softened to make the interface look calmer. If the last sync failed,
 * the student is told, because the alternative is presenting stale coursework
 * as current — and the cost of that is a missed deadline.
 *
 * Fresh data gets a quiet grey line. Stale or failed data gets a full banner,
 * because at that point it is the most important thing on the screen.
 */

export interface SyncStatusProps {
  readonly freshness: FreshnessView;
  readonly variant?: 'inline' | 'banner';
}

export function SyncStatus({ freshness, variant = 'inline' }: SyncStatusProps) {
  const config = FRESHNESS[freshness.level];

  if (variant === 'inline' && !config.prominent) {
    return (
      <p className="flex items-center gap-1.5 text-[0.75rem] text-ink-muted">
        <ClockIcon className="size-3.5" aria-hidden="true" />
        Updated {formatAge(freshness.ageMs)}
      </p>
    );
  }

  if (!config.prominent) return null;

  const headline =
    freshness.level === 'UNAVAILABLE'
      ? 'Google Classroom is not connected'
      : freshness.level === 'PARTIAL'
        ? "Some courses didn't sync"
        : "Couldn't refresh Classroom";

  // The distinction that matters: this is not "loading failed", it is "what you
  // are looking at is old". Naming the age is the whole point.
  const detail =
    freshness.lastSuccessfulSyncAt === null
      ? 'Nothing has been synced yet.'
      : `Showing data from ${formatAge(freshness.ageMs)}.`;

  return (
    <div
      role="status"
      className={cx(
        'surface-flat mb-5 flex items-start gap-3 p-3.5',
        freshness.level === 'UNAVAILABLE'
          ? 'border-danger/35 bg-danger-soft'
          : 'border-warning/35 bg-warning-soft',
      )}
    >
      <AlertIcon
        className={cx(
          'mt-0.5 size-5 shrink-0',
          freshness.level === 'UNAVAILABLE' ? 'text-danger' : 'text-warning',
        )}
      />
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold text-ink">{headline}</p>
        <p className="mt-0.5 text-[0.8125rem] text-ink-soft">{detail}</p>
      </div>
    </div>
  );
}
