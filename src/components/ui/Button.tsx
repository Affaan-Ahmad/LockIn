import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * The only button in the application. Similar actions look similar; there is no
 * per-page variant.
 *
 * Four ranks, and only one of them is filled. A screen with three filled
 * buttons has no primary action, so secondary sits on the raised surface and
 * tertiary carries no container at all until it is hovered. That is what makes
 * the primary obvious without having to shout.
 *
 * Not a pill. A fully round 44px button reads as a toy and fought every card
 * corner it sat inside; the softened rectangle belongs to the same family as
 * the surfaces around it.
 *
 * Every size clears a 44px touch target. Presses animate `transform` only --
 * animating shadow or padding would repaint or reflow on every frame.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium ' +
  'cursor-pointer select-none press active:translate-y-px ' +
  // Focus is not styled here. globals.css defines one :focus-visible outline
  // for the whole product; a ring on top of it drew two indicators, and the
  // `outline-none` that came with the ring suppressed the global rule.
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0';

const VARIANT: Record<ButtonVariant, string> = {
  // The only filled button. Its shadow is the clay tier, so the one action a
  // screen is asking for is also the one thing standing off the surface.
  primary: 'bg-brand text-on-brand shadow-clay hover:bg-brand-hover',
  secondary: 'surface-raised text-ink hover:bg-overlay',
  // No container until hovered. A tertiary action that already looks like a
  // button competes with the secondary one beside it.
  ghost: 'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink',
  // Filled, and visually distinct from primary rather than a shade of it:
  // deleting an account must not look like confirming one.
  danger: 'bg-danger text-white shadow-clay hover:brightness-[0.94]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
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
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled === true || busy}
      // Announces the pending state to assistive tech, which a spinner alone
      // does not.
      aria-busy={busy || undefined}
      className={cx(
        BASE,
        VARIANT[variant],
        size === 'sm' ? 'min-h-9 px-3.5 text-sm' : 'min-h-11 px-5 text-base',
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
    </button>
  );
}
