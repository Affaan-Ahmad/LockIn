'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';

import { cx } from '@/lib/cx';
import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * The only button in the application. Similar actions look similar; there is no
 * per-page variant.
 *
 * Four ranks, and only one of them is filled. A screen with three filled
 * buttons has no primary action, so secondary sits on the raised surface and
 * tertiary carries no container at all until it is hovered. That is what makes
 * the primary obvious without having to shout.
 *
 * Cut from the same stock as the sheets around it: a 3px corner, a hard edge
 * and a stacked shadow. Nothing here is a pill -- a fully round control in a
 * stack of cut paper reads as borrowed from a different interface.
 *
 * A press pushes the sheet *into* the page rather than dimming or shrinking it,
 * which is why the tap animation moves down instead of scaling.
 *
 * Every size clears a 44px touch target. Presses animate `transform` only --
 * animating shadow or padding would repaint or reflow on every frame.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm ' +
  'cursor-pointer select-none tracking-[-0.01em] transition-[box-shadow,color] duration-[160ms] ' +
  'active:shadow-press ' +
  // Focus is not styled here. globals.css defines one :focus-visible outline
  // for the whole product; a ring on top of it drew two indicators, and the
  // `outline-none` that came with the ring suppressed the global rule.
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0';

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // The only filled button, and the only control the warm glow touches. The
  // glow sits *under* the sheet -- light escaping from the gap beneath it --
  // never on its face and never on its label.
  // The under-glow is light escaping from the gap beneath a raised sheet, which
  // is a paper idea. The workbench's primary is a solid near-black block and
  // gets the plain clay shadow it was designed with.
  primary:
    'bg-kraft text-on-brand font-bold border border-kraft-2 ' +
    'paper:shadow-[var(--lift-2),0_12px_22px_-12px_var(--glow-deep)] ' +
    'paper:hover:shadow-[var(--lift-3),0_14px_26px_-12px_var(--glow-deep)] ' +
    'workbench:border-transparent workbench:shadow-clay',
  secondary:
    'bg-p3 text-ink font-semibold border border-edge shadow-lift-1 hover:shadow-lift-2 ' +
    'workbench:border-line-strong',
  // No container until hovered. A tertiary action that already looks like a
  // button competes with the secondary one beside it.
  ghost: 'bg-transparent text-ink-soft font-medium hover:text-ink',
  // Filled, and visually distinct from primary rather than a shade of it:
  // deleting an account must not look like confirming one. Terra is the only
  // red in the system, which is exactly why it is trustworthy here.
  danger: 'bg-terra text-on-fill font-bold border border-terra shadow-lift-2 hover:shadow-lift-3',
};

export interface ButtonProps extends HTMLMotionProps<'button'> {
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'sm';
  readonly fullWidth?: boolean;
  /** Shows a spinner and disables. The label stays, so the button never resizes. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const reduce = useReducedMotion();
  const inert = disabled === true || busy;
  return (
    <motion.button
      type="button"
      {...rest}
      disabled={inert}
      whileHover={inert || reduce ? {} : { y: -2 }}
      whileTap={inert || reduce ? {} : { y: 2 }}
      // Announces the pending state to assistive tech, which a spinner alone
      // does not.
      aria-busy={busy || undefined}
      className={cx(
        BASE,
        BUTTON_VARIANT[variant],
        size === 'sm' ? 'min-h-10 px-3.5 text-[13px]' : 'min-h-11 px-4 text-[13.5px]',
        fullWidth ? 'w-full' : '',
        className,
      )}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : null}
      {children}
    </motion.button>
  );
}

/** Navigation uses an anchor, never a button nested inside one. */
export function ButtonLink({ variant = 'secondary', size: _size, fullWidth = false, className, ...props }: ComponentProps<typeof Link> & {
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'sm';
  readonly fullWidth?: boolean;
}) {
  void _size;
  // The same classes the button uses, not a parallel `.button-link` rule. Two
  // definitions of "primary" is how a link and a button start to disagree.
  return (
    <Link
      {...props}
      className={cx(
        BASE,
        BUTTON_VARIANT[variant],
        'min-h-11 px-4 text-[13.5px]',
        'transition-[transform,box-shadow,color] hover:-translate-y-[2px] active:translate-y-[2px]',
        'motion-reduce:transform-none motion-reduce:transition-none',
        fullWidth && 'w-full',
        className,
      )}
    />
  );
}
