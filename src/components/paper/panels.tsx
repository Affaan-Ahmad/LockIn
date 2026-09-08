import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { Caption } from './marks';
import { RecessedWell } from './surfaces';

/**
 * The panels every screen but Today is built from.
 *
 * Today earned bespoke components because it is the screen the product exists
 * for. Everything else shares these, so a heading on Upcoming and a heading on
 * Settings are the same object rather than two near-identical ones that drift.
 */

export interface PaperEmptyProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
}

/**
 * Nothing here, said on a sheet pressed into the page.
 *
 * Recessed rather than raised: an empty state is a hole in the content, and
 * lifting it would give the absence of work more presence than the work.
 */
export function PaperEmpty({ icon, title, body, action }: PaperEmptyProps) {
  return (
    <RecessedWell className="flex flex-col items-center gap-3 px-6 py-14 text-center workbench:bg-transparent workbench:shadow-none">
      {icon === undefined ? null : (
        <span className="flex size-10 items-center justify-center rounded-xs bg-p3 text-ink-soft shadow-lift-1 workbench:size-9 workbench:rounded-pill workbench:bg-sunken workbench:text-ink-muted workbench:shadow-none">
          {icon}
        </span>
      )}
      <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ink workbench:text-base workbench:font-medium workbench:tracking-normal">
        {title}
      </h2>
      {body === undefined ? null : (
        <p className="max-w-[34ch] text-[13px] leading-relaxed text-pretty text-ink-soft">{body}</p>
      )}
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </RecessedWell>
  );
}

export interface PaperNoticeProps {
  readonly tone?: 'terra' | 'glow-deep' | 'slate';
  readonly icon?: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

const NOTICE_BAR: Readonly<Record<'terra' | 'glow-deep' | 'slate', string>> = {
  terra: 'bg-terra',
  'glow-deep': 'bg-glow-deep',
  slate: 'bg-slate',
};

/**
 * Something is wrong and the student needs to know before reading on.
 *
 * The tone lives in a 5px edge, never in the fill. A tinted panel behind body
 * text either fails contrast or is too pale to notice, and it collapses to the
 * same grey as every other panel in forced colours.
 */
export function PaperNotice({
  tone = 'glow-deep',
  icon,
  title,
  children,
  className,
}: PaperNoticeProps) {
  return (
    <div
      role="status"
      className={cx('relative overflow-hidden rounded-sm bg-p3 shadow-lift-1', className)}
    >
      <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-[5px]', NOTICE_BAR[tone])} />
      <div className="flex gap-3 py-3.5 pr-4 pl-5">
        {icon === undefined ? null : <span className="mt-px shrink-0 text-ink-soft">{icon}</span>}
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink">{title}</p>
          {children === undefined ? null : (
            <div className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export interface PaperSectionProps {
  readonly id?: string;
  readonly label: string;
  /** The right-hand end of the rule: a count, a link, a control. */
  readonly aside?: ReactNode;
  readonly className?: string;
}

/** A caption, a hairline across the remaining width, and an optional aside. */
export function PaperSectionRule({ id, label, aside, className }: PaperSectionProps) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <Caption>
        <span id={id}>{label}</span>
      </Caption>
      <span aria-hidden="true" className="h-px flex-1 bg-edge-soft" />
      {aside === undefined ? null : (
        <span className="shrink-0 font-mono text-[11.5px] text-ink-faint tabular-nums">{aside}</span>
      )}
    </div>
  );
}

/** The rail's own heading. Smaller than a section rule, and never has a rule. */
export function PaperRailHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{children}</h2>
  );
}
