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
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon === undefined ? null : (
        // Smaller and quieter than before. A large tinted medallion above two
        // lines of text is the shape of a placeholder; at this size it reads
        // as punctuation for the sentence below it.
        <span className="flex size-9 items-center justify-center rounded-pill bg-sunken text-ink-muted">
          {icon}
        </span>
      )}
      <h2 className="text-base font-medium text-ink">{title}</h2>
      {body === undefined ? null : (
        <p className="max-w-[30ch] text-sm text-pretty text-ink-muted">{body}</p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
