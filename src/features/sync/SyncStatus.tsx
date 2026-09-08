import { AlertIcon, ClockIcon } from '@/components/icons';
import { PaperNotice, SyncPill, type SyncTone } from '@/components/paper';
import { readSkin } from '@/lib/preferences';
import type { FreshnessView } from '@/lib/queries';
import { syncPresentation } from './status-presentation';

/**
 * How recently LockIn read Classroom, said in two places.
 *
 * Inline it sits beside the page title; prominent it is a notice above the
 * content. Both are driven by the same `syncPresentation`, so the header and the
 * banner can never disagree about whether a sync failed.
 *
 * The two skins say it differently enough that this branches rather than
 * restyles. Paper states it on a small sheet with a square dot; the workbench
 * states it as a line of text with a clock. Those are different elements, not
 * one element in two colours, and rendering both to hide one would put the same
 * sentence in the accessibility tree twice.
 *
 * In both, the tone is confirmation rather than the signal: the words already
 * say what the colour says.
 */

export interface SyncStatusProps {
  readonly freshness: FreshnessView;
  readonly variant?: 'inline' | 'banner';
}

const PILL_TONE: Readonly<Record<'neutral' | 'warning' | 'danger', SyncTone>> = {
  neutral: 'moss',
  warning: 'glow-deep',
  danger: 'terra',
};

const NOTICE_TONE: Readonly<
  Record<'neutral' | 'warning' | 'danger', 'slate' | 'glow-deep' | 'terra'>
> = {
  neutral: 'slate',
  warning: 'glow-deep',
  danger: 'terra',
};

export async function SyncStatus({ freshness, variant = 'inline' }: SyncStatusProps) {
  const state = syncPresentation(freshness);
  const workbench = (await readSkin()) === 'workbench';

  if (variant === 'inline') {
    if (workbench) {
      return (
        <p className="sync-inline" data-tone={state.tone}>
          <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{state.label}</span>
        </p>
      );
    }
    return (
      <SyncPill tone={PILL_TONE[state.tone]} className="max-w-[13rem]">
        <span className="truncate">{state.label}</span>
      </SyncPill>
    );
  }

  if (!state.prominent) return null;

  if (workbench) {
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

  return (
    <PaperNotice
      tone={NOTICE_TONE[state.tone]}
      icon={<AlertIcon className="size-4" aria-hidden="true" />}
      title={state.label}
      className="mb-6"
    >
      {state.detail}
    </PaperNotice>
  );
}
