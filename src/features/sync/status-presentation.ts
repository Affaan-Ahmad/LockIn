import type { FreshnessView } from '@/lib/queries';
import { formatAge } from '@/lib/format';

export interface SyncPresentation {
  readonly label: string;
  readonly detail: string;
  readonly tone: 'neutral' | 'warning' | 'danger';
  readonly prominent: boolean;
}

/** Labels only. Freshness and run status remain separate authoritative backend facts. */
export function syncPresentation(freshness: FreshnessView): SyncPresentation {
  const detail = freshness.lastSuccessfulSyncAt === null
    ? 'No successful sync yet. Coursework may be missing.'
    : `Last complete update ${formatAge(freshness.ageMs)}. Coursework may have changed since then.`;
  if (freshness.connectionUsable === false) {
    return { label: 'Reconnect Google Classroom', detail: 'Your connection needs attention in Settings.', tone: 'danger', prominent: true };
  }
  switch (freshness.lastRunStatus) {
    // QUEUED is in flight too: a worker reached its deadline and handed the run
    // over, and a continuation is picking it up. Falling through to the
    // freshness labels below would say "showing older coursework" while a sync
    // is actually running.
    case 'QUEUED':
    case 'RUNNING':
      return { label: 'Sync in progress', detail, tone: 'neutral', prominent: true };
    case 'FAILED':
    case 'ABANDONED':
      return { label: "Classroom couldn't refresh", detail, tone: 'danger', prominent: true };
    case 'PARTIAL_SUCCESS':
      return { label: "Some courses couldn't sync", detail, tone: 'warning', prominent: true };
  }
  switch (freshness.level) {
    case 'UNAVAILABLE':
      return { label: 'Coursework not synced yet', detail, tone: 'warning', prominent: true };
    case 'PARTIAL':
      return { label: "Some courses couldn't sync", detail, tone: 'warning', prominent: true };
    case 'STALE':
      return { label: 'Showing older coursework', detail, tone: 'warning', prominent: true };
    case 'AGEING':
      return { label: `Last updated ${formatAge(freshness.ageMs)}`, detail, tone: 'neutral', prominent: false };
    case 'FRESH':
      return { label: `Updated ${formatAge(freshness.ageMs)}`, detail, tone: 'neutral', prominent: false };
  }
}
