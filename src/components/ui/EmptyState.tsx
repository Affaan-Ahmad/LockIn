import type { ReactNode } from 'react';

/**
 * An empty state.
 *
 * Text and one optional action. No illustration: a decorative SVG large enough
 * to be worth looking at is bytes spent on a screen the student wants to leave,
 * and the message is what actually helps.
 */

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon === undefined ? null : (
        <span className="surface-sunken flex size-14 items-center justify-center rounded-pill text-ink-muted">
          {icon}
        </span>
      )}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {body === undefined ? null : (
        <p className="max-w-[26rem] text-base text-ink-soft">{body}</p>
      )}
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </div>
  );
}
