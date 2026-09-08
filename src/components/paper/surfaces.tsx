import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * The sheets.
 *
 * One rule governs everything here: a surface sits on a *visible* sheet below
 * it. Elevation is not a blur — it is stacked paper edges, hard 1–4px offsets
 * in sheet colours, with a single soft ambient shadow underneath. That is why
 * there are exactly five steps and no ad-hoc shadows: an arbitrary sixth value
 * reads as a mistake in a stack where every other edge is deliberate.
 *
 * Contour stacking is rationed to two components in the whole product — the
 * hero copy block and Needs Review — because depth stops meaning anything once
 * everything has it.
 */

export type Tone = 'p0' | 'p1' | 'p2' | 'p3';
export type Lift = 0 | 1 | 2 | 3 | 4;

const TONE: Readonly<Record<Tone, string>> = {
  p0: 'bg-p0',
  p1: 'bg-p1',
  p2: 'bg-p2',
  p3: 'bg-p3',
};

const LIFT: Readonly<Record<Lift, string>> = {
  0: 'shadow-lift-0',
  1: 'shadow-lift-1',
  2: 'shadow-lift-2',
  3: 'shadow-lift-3',
  4: 'shadow-lift-4',
};

export interface PaperSurfaceProps {
  readonly tone?: Tone;
  readonly lift?: Lift;
  /** Barely-visible crossed hairlines. Used on grounds and the main sheet. */
  readonly grain?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function PaperSurface({
  tone = 'p2',
  lift = 0,
  grain = false,
  className,
  children,
}: PaperSurfaceProps) {
  return (
    <div className={cx(TONE[tone], LIFT[lift], grain && 'grain', 'rounded-sm', className)}>
      {children}
    </div>
  );
}

export type StatusTone = 'terra' | 'glow-deep' | 'slate' | 'moss' | 'edge';

const STATUS: Readonly<Record<StatusTone, string>> = {
  terra: 'bg-terra',
  'glow-deep': 'bg-glow-deep',
  slate: 'bg-slate',
  moss: 'bg-moss',
  edge: 'bg-edge',
};

export interface LayeredCardProps {
  readonly lift?: Lift;
  readonly tone?: Tone;
  /** A coloured bar down the left edge, or across the top for `Late`. */
  readonly status?: StatusTone;
  readonly statusEdge?: 'left' | 'top';
  /** Raises one step on hover. Off for anything that is not itself a target. */
  readonly interactive?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export function LayeredCard({
  lift = 1,
  tone = 'p3',
  status,
  statusEdge = 'left',
  interactive = false,
  className,
  children,
}: LayeredCardProps) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-sm',
        TONE[tone],
        LIFT[lift],
        interactive &&
          'transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[3px] hover:shadow-lift-3 motion-reduce:transform-none motion-reduce:transition-none',
        className,
      )}
    >
      {status === undefined ? null : (
        <span
          aria-hidden="true"
          className={cx(
            'absolute',
            STATUS[status],
            statusEdge === 'left' ? 'inset-y-0 left-0 w-[5px]' : 'inset-x-0 top-0 h-[4px]',
          )}
        />
      )}
      {children}
    </div>
  );
}

export interface ContourCardProps {
  readonly className?: string;
  /** The warm pool of light escaping from under the forward sheet. */
  readonly glow?: boolean;
  readonly children: ReactNode;
}

/**
 * A card with offset sheets cut slightly out of register behind it.
 *
 * Allowed on exactly two things, per the design: the landing hero's copy block
 * and Needs Review. Both are the single most important object on their screen,
 * and the extra sheets are how the eye is told so without a colour or a size
 * change.
 */
export function ContourCard({ className, glow = false, children }: ContourCardProps) {
  return (
    <div className="relative isolate">
      {glow ? <span aria-hidden="true" className="glow-pool" /> : null}
      <div className={cx('contour rounded-sm bg-p3 shadow-lift-3', className)}>{children}</div>
    </div>
  );
}

export interface RecessedWellProps {
  readonly tone?: 'p0' | 'p1';
  readonly className?: string;
  readonly children: ReactNode;
}

/** A sheet pressed *into* the one behind it. Evidence lists, empty states. */
export function RecessedWell({ tone = 'p1', className, children }: RecessedWellProps) {
  return (
    <div className={cx('rounded-sm shadow-press', TONE[tone], className)}>{children}</div>
  );
}
