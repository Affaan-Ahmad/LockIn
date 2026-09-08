import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';

import { cx } from '@/lib/cx';

/**
 * Controls, cut from the same stock as everything else.
 *
 * Corners are nearly square — 2px on tags and toggles, 3px on buttons and tabs.
 * Nothing is a pill. A fully rounded control in a stack of cut sheets reads as
 * borrowed from a different interface.
 *
 * The primary button is the only place the warm glow appears on a control, and
 * it appears *under* it: a pool of light escaping from the gap beneath a raised
 * sheet, never a border and never the label.
 */

export type PaperButtonVariant = 'primary' | 'secondary' | 'quiet';
export type PaperButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Readonly<Record<PaperButtonSize, string>> = {
  sm: 'min-h-10 px-3.5 text-[13px]',
  md: 'min-h-11 px-4 text-[13.5px]',
  lg: 'min-h-12 px-5 text-[14.5px]',
};

const VARIANT: Readonly<Record<PaperButtonVariant, string>> = {
  // The under-glow is the light in the gap beneath the sheet, not a colour on it.
  primary:
    'bg-kraft text-on-brand font-bold border border-kraft-2 shadow-[var(--lift-2),0_12px_22px_-12px_var(--glow-deep)] hover:shadow-[var(--lift-3),0_14px_26px_-12px_var(--glow-deep)]',
  secondary: 'bg-p3 text-ink font-semibold border border-edge shadow-lift-1 hover:shadow-lift-2',
  quiet: 'bg-transparent text-ink-soft font-medium hover:text-ink',
};

const BASE = cx(
  'inline-flex items-center justify-center gap-2 rounded-sm select-none',
  'tracking-[-0.01em] transition-[transform,box-shadow,color] duration-[160ms] ease-out',
  // Press pushes the sheet into the page rather than dimming it.
  'active:translate-y-[2px] active:shadow-press',
  'hover:-translate-y-[2px]',
  'focus-visible:paper-focus',
  'disabled:pointer-events-none disabled:opacity-55 disabled:shadow-lift-0',
  'motion-reduce:transform-none motion-reduce:transition-none',
);

export interface PaperButtonProps extends ComponentProps<'button'> {
  readonly variant?: PaperButtonVariant;
  readonly size?: PaperButtonSize;
}

export function PaperButton({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: PaperButtonProps) {
  return <button {...rest} className={cx(BASE, SIZE[size], VARIANT[variant], className)} />;
}

export function PaperButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ComponentProps<typeof Link> & {
  readonly variant?: PaperButtonVariant;
  readonly size?: PaperButtonSize;
}) {
  return <Link {...rest} className={cx(BASE, SIZE[size], VARIANT[variant], className)} />;
}

export interface PaperTabProps {
  readonly active?: boolean;
  readonly href: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A tab with its top-right corner trimmed off, the way a paper tab is cut.
 *
 * The active one is a cardstock sheet lifted 3px clear of the row with a strip
 * of glow along its bottom edge, so it reads as joined to the content below it
 * rather than as a highlighted button.
 */
export function PaperTab({ active = false, href, children, className }: PaperTabProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'paper-tab relative inline-flex min-h-10 items-center px-4 text-[13px] transition-all duration-[160ms]',
        active
          ? 'bg-p3 -translate-y-[3px] font-semibold text-ink shadow-lift-2'
          : 'bg-p1 font-medium text-ink-soft shadow-lift-0 hover:text-ink',
        'motion-reduce:transform-none motion-reduce:transition-none',
        className,
      )}
    >
      {children}
      {active ? (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-glow" />
      ) : null}
    </Link>
  );
}

export interface PaperBadgeProps {
  /** `count` is the slate review badge; `state` is a quiet parchment chip. */
  readonly tone?: 'state' | 'count';
  /** A tooltip for a chip whose one word needs a sentence behind it. */
  readonly title?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function PaperBadge({ tone = 'state', title, className, children }: PaperBadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center rounded-xs px-2 py-0.5 text-[11px] font-medium',
        tone === 'count'
          ? 'bg-slate text-on-fill font-semibold tabular-nums'
          : 'bg-p1 text-ink-soft shadow-lift-0',
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface PaperTogglePropsProps {
  readonly on: boolean;
  readonly label: string;
  readonly onToggle?: () => void;
}

/** 36×22, 2px corners. The track is pressed in; the knob is a raised sheet. */
export function PaperToggle({ on, label, onToggle }: PaperTogglePropsProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cx(
        'relative h-[22px] w-9 shrink-0 rounded-xs shadow-press transition-colors duration-[160ms]',
        'focus-visible:paper-focus',
        on ? 'bg-kraft' : 'bg-p1',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-[3px] size-4 rounded-xs bg-p3 shadow-lift-1 transition-[left] duration-[160ms]',
          on ? 'left-[17px]' : 'left-[3px]',
          'motion-reduce:transition-none',
        )}
      />
    </button>
  );
}
