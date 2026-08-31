import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * The two surface families.
 *
 * Neomorphic variants (`raised`, `sunken`) are structural chrome: navigation,
 * segmented controls, settings rows. Clay is for content the student should
 * want to touch: assignment cards, course cards, summaries.
 *
 * The composed treatments live as `@utility` rules in globals.css rather than
 * as utility strings here, because a clay card is a background, a border, a
 * radius and two shadow layers — spelling that out on every element is how a
 * design system turns into forty slightly different shadows nobody can retune.
 *
 * A Server Component. It renders markup and never needs the browser.
 */

export type SurfaceVariant = 'raised' | 'sunken' | 'clay' | 'flat';
export type SurfacePad = 'none' | 'sm' | 'md' | 'lg';

const VARIANT: Record<SurfaceVariant, string> = {
  raised: 'surface-raised',
  sunken: 'surface-sunken',
  clay: 'clay',
  flat: 'surface-flat',
};

const PAD: Record<SurfacePad, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export interface SurfaceProps {
  readonly variant?: SurfaceVariant;
  readonly pad?: SurfacePad;
  /** Adds hover lift and press feedback. Only for surfaces that do something. */
  readonly interactive?: boolean;
  readonly as?: 'div' | 'section' | 'article' | 'li' | 'aside' | 'header' | 'nav';
  readonly className?: string;
  readonly children: ReactNode;
}

export function Surface({
  variant = 'raised',
  pad = 'md',
  interactive = false,
  as: Tag = 'div',
  className,
  children,
}: SurfaceProps) {
  return (
    <Tag
      className={cx(
        VARIANT[variant],
        PAD[pad],
        interactive ? 'lift active:translate-y-px hover:-translate-y-px' : '',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
