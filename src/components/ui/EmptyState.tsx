import type { ReactNode } from 'react';

import { PaperEmpty } from '@/components/paper';

/**
 * An empty state.
 *
 * Text and one optional action. No illustration: a decorative SVG large enough
 * to be worth looking at is bytes spent on a screen the student wants to leave,
 * and the message is what actually helps.
 *
 * Kept as its own name rather than replaced at every call site, because "this
 * screen has nothing on it" is a product concept and `PaperEmpty` is only the
 * material it is currently made of.
 */

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <PaperEmpty
      {...(icon === undefined ? {} : { icon })}
      title={title}
      {...(body === undefined ? {} : { body })}
      {...(action === undefined ? {} : { action })}
    />
  );
}
