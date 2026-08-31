import type { ReactNode } from 'react';

import { cx, s } from '@/lib/cx';

import styles from './Surface.module.css';

/**
 * The two surface families, as one component.
 *
 * Neomorphic variants (`raised`, `sunken`) are for structural chrome:
 * navigation, segmented controls, settings rows. Clay is for content the
 * student should want to touch: assignment cards, course cards, summaries.
 *
 * It exists so shadow values live in exactly one place. Scattering
 * `box-shadow: 2px 2px 5px ...` through components is how a design system turns
 * into forty slightly different shadows nobody can retune.
 *
 * A Server Component: it renders markup and never needs the browser.
 */

export type SurfaceVariant = 'raised' | 'raisedLg' | 'sunken' | 'clay' | 'flat';
export type SurfacePad = 'none' | 'sm' | 'md' | 'lg';

export interface SurfaceProps {
  readonly variant?: SurfaceVariant;
  readonly pad?: SurfacePad;
  /** Adds press/hover feedback. Only for surfaces that actually do something. */
  readonly interactive?: boolean;
  readonly as?: 'div' | 'section' | 'article' | 'li' | 'aside' | 'header' | 'nav';
  readonly className?: string;
  readonly children: ReactNode;
}

const PAD: Record<SurfacePad, string> = {
  none: '',
  sm: 'padSm',
  md: 'padMd',
  lg: 'padLg',
};

export function Surface({
  variant = 'raised',
  pad = 'md',
  interactive = false,
  as: Tag = 'div',
  className,
  children,
}: SurfaceProps) {
  const isClay = variant === 'clay';

  return (
    <Tag
      className={cx(
        s(styles, isClay ? 'clay' : 'surface'),
        isClay ? '' : s(styles, variant),
        s(styles, PAD[pad]),
        interactive ? s(styles, 'interactive') : '',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
