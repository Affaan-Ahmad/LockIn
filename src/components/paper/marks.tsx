import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

/**
 * The small marks: the logo tile, punched icon wells, the sync pill, and the
 * pencilled annotations.
 *
 * Handwriting is annotation only. It never carries a value, a label or a
 * control — a due time set in a script face is a due time nobody trusts.
 */

export interface LogoTileProps {
  readonly size?: number;
  readonly className?: string;
}

/** The mark, cut into a kraft tile. Same geometry as the app icon. */
export function LogoTile({ size = 30, className }: LogoTileProps) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-sm bg-kraft shadow-lift-1',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size * 0.55}
        height={size * 0.55}
        aria-hidden="true"
        focusable="false"
        fill="currentColor"
        className="text-ink"
      >
        <path d="M9 6h13v39h28v13H9z" />
        <rect x="30" y="6" width="13" height="26" />
      </svg>
    </span>
  );
}

export interface CutoutIconProps {
  readonly size?: number;
  readonly className?: string;
  readonly children: ReactNode;
}

/** An icon punched into the sheet: a pressed parchment well, no gloss. */
export function CutoutIcon({ size = 40, className, children }: CutoutIconProps) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-xs bg-p1 text-ink-soft shadow-press',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

export type SyncTone = 'moss' | 'glow-deep' | 'slate' | 'terra';

const DOT: Readonly<Record<SyncTone, string>> = {
  moss: 'bg-moss',
  'glow-deep': 'bg-glow-deep',
  slate: 'bg-slate',
  terra: 'bg-terra',
};

export interface SyncPillProps {
  readonly tone?: SyncTone;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Freshness, stated rather than implied.
 *
 * The dot is a square, not a circle — nothing in this system is round — and it
 * is never the only signal: the words beside it say the same thing, because a
 * colour alone is invisible in greyscale and to a red-green colour-blind
 * reader.
 */
export function SyncPill({ tone = 'moss', children, className }: SyncPillProps) {
  return (
    <span
      className={cx(
        'inline-flex min-h-[38px] items-center gap-2 rounded-sm bg-p3 px-3 shadow-lift-1',
        'font-mono text-[12px] text-ink-soft tabular-nums',
        className,
      )}
    >
      <span aria-hidden="true" className={cx('size-[7px] shrink-0 rounded-[1px]', DOT[tone])} />
      {children}
    </span>
  );
}

export interface AnnotationProps {
  /** Degrees. The design rotates between −4 and +3; anything more reads as broken. */
  readonly rotate?: number;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A pencilled note on a torn scrap, laid over the layout.
 *
 * Decorative by construction: it is `aria-hidden`, because a screen reader
 * announcing "your section only" out of context is noise, and everything it
 * says is already said by the interface it points at.
 */
export function Annotation({ rotate = -3, className, children }: AnnotationProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'pointer-events-none inline-block rounded-xs bg-p3 px-2 py-0.5 shadow-lift-2',
        'font-hand text-[17px] leading-tight text-kraft-3 select-none',
        className,
      )}
      style={{ transform: `rotate(${String(rotate)}deg)` }}
    >
      {children}
    </span>
  );
}

/** A mono caption: uppercase, wide-tracked, the smallest type in the system. */
export function Caption({ className, children }: { readonly className?: string; readonly children: ReactNode }) {
  return (
    <span
      className={cx(
        'font-mono text-[10.5px] font-medium tracking-[0.14em] text-ink-faint uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}
