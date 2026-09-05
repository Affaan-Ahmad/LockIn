import { AlertIcon, ClockIcon } from '@/components/icons';
import type { FreshnessView } from '@/lib/queries';
import { syncPresentation } from './status-presentation';

export interface SyncStatusProps {
  readonly freshness: FreshnessView;
  readonly variant?: 'inline' | 'banner';
}

export function SyncStatus({ freshness, variant = 'inline' }: SyncStatusProps) {
  const state = syncPresentation(freshness);
  if (variant === 'inline') {
    return (
      <p className="sync-inline" data-tone={state.tone}>
        <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{state.label}</span>
      </p>
    );
  }
  if (!state.prominent) return null;
  return (
    <div role="status" className="sync-notice" data-tone={state.tone}>
      <AlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-ink">{state.label}</p>
        <p className="mt-1 text-sm text-ink-soft">{state.detail}</p>
      </div>
    </div>
  );
}
