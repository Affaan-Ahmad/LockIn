import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * The only button in the application. Similar actions look similar; there is no
 * per-page variant.
 *
 * Every size clears a 44px touch target. Presses animate `transform` only —
 * animating shadow or padding would repaint or reflow on every frame.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-pill font-semibold ' +
  'tracking-[-0.01em] cursor-pointer select-none press active:scale-[0.97] ' +
  'transition-[transform,background-color,opacity] duration-[120ms] ease-out ' +
  'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand shadow-clay hover:bg-brand-hover',
  secondary: 'bg-raised text-ink border border-line shadow-raised hover:bg-overlay',
  ghost: 'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink',
  // Visually distinct from primary rather than a different shade of it:
  // deleting an account must not look like confirming one.
  danger: 'bg-danger text-white shadow-clay hover:brightness-95',
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
        size === 'sm' ? 'min-h-9 px-4 text-[0.8125rem]' : 'min-h-11 px-6 text-[0.9375rem]',
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
