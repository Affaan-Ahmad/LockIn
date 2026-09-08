import type { ReactNode } from 'react';

import { readSkin } from '@/lib/preferences';
import { AppShell } from './AppShell';
import { PaperShell } from './PaperShell';

/**
 * The page frame, whichever one the student chose.
 *
 * Every screen renders this rather than a named shell, so the choice is made in
 * exactly one place. The two frames are genuinely different designs -- paper
 * floats an ivory sheet on a sand ground with the sidebar cut from the ground
 * itself; workbench sets a bordered sidebar beside a bordered header -- but they
 * take the same props, because they present the same five facts: a title, a
 * line beneath it, the review count, what belongs opposite the title, and an
 * optional context column.
 *
 * A Server Component, and the read is memoised per request, so this costs one
 * cookie lookup for the whole page however deep the tree goes.
 */

export interface ShellProps {
  readonly title: string;
  /** The line beneath the title: the date, the counts. */
  readonly subtitle?: ReactNode;
  readonly reviewCount?: number;
  /** Sits opposite the title — freshness and the sync control. */
  readonly headerAside?: ReactNode;
  /** The context column: a calendar, a cohort picker, a room finder. */
  readonly rail?: ReactNode;
  readonly children: ReactNode;
}

export async function Shell({ title, subtitle, rail, ...rest }: ShellProps) {
  if ((await readSkin()) === 'workbench') {
    return (
      <AppShell
        title={title}
        // The workbench header types its subtitle into a `<p>` and needs a
        // string; paper takes any node. Anything richer than text is dropped
        // rather than stringified into `[object Object]`.
        {...(typeof subtitle === 'string' ? { subtitle } : {})}
        {...(rail === undefined ? {} : { rail })}
        {...rest}
      />
    );
  }

  return (
    <PaperShell
      title={title}
      {...(subtitle === undefined ? {} : { subtitle })}
      {...(rail === undefined ? {} : { rail })}
      {...rest}
    />
  );
}
