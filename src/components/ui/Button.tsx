import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx, s } from '@/lib/cx';

import styles from './Button.module.css';

/**
 * The only button in the application.
 *
 * A Server Component. Buttons inside forms or client islands still render from
 * here; the variant decides appearance, and nothing about that needs the
 * browser. Only the island around it does.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

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
        s(styles, 'button'),
        s(styles, variant),
        size === 'sm' ? s(styles, 'sm') : '',
        fullWidth ? s(styles, 'full') : '',
        className,
      )}
    >
      {busy ? <span className={s(styles, 'spinner')} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
