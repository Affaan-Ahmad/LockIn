import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Contrast guarantees for the brand palette.
 *
 * These exist because the brand is a 90%-lightness lime, which is legible on
 * almost nothing. Every other colour in the system tolerates being used in the
 * wrong role and merely looks slightly off; lime used as text measures 1.2:1
 * and is *gone*. Nothing in TypeScript, ESLint or the build catches that, and
 * it is invisible in a screenshot taken on the theme where it happens to work.
 *
 * So the ratios are asserted against the real token values parsed out of
 * globals.css. A future retune that drags --brand down to a text-safe lightness
 * (losing the mark's colour) or promotes --brand-ink up to the lime (losing the
 * legibility) fails here rather than in front of a student.
 */

const CSS = readFileSync('src/app/globals.css', 'utf8');

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Reads one `--token: oklch(L% C H);` declaration. */
function token(name: string): Oklch {
  const match = new RegExp(
    `--${name}:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`,
  ).exec(CSS);

  if (match === null) throw new Error(`--${name} not found, or not a literal oklch() value`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const L = l / 100;
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);

  const lp = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
}

function relativeLuminance(colour: Oklch): number {
  const [r, g, b] = toLinearRgb(colour).map((channel) => Math.max(0, Math.min(1, channel))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the lime fill', () => {
  it('carries near-black, not near-white', () => {
    // The single most dangerous pairing in the system. White on this lime is
    // 1.3:1 -- a primary button whose label cannot be read at all.
    expect(contrast(token('ink-on-brand'), token('brand'))).toBeGreaterThanOrEqual(4.5);
  });

  it('stays readable on its hover state too', () => {
    expect(contrast(token('ink-on-brand'), token('brand-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('is genuinely the mark’s lime and not a darkened stand-in', () => {
    // If a future change makes --brand text-safe on a light ground, it has
    // stopped being the brand colour. The split exists precisely so this token
    // never has to compromise.
    const brand = token('brand');
    expect(brand.l).toBeGreaterThan(85);
    expect(brand.c).toBeGreaterThan(0.15);
  });
});

describe('brand-coloured text', () => {
  it('meets AA body text on the light ground', () => {
    expect(contrast(token('brand-ink'), token('surface-ground'))).toBeGreaterThanOrEqual(4.5);
  });

  it('meets AA on raised and sunken surfaces as well', () => {
    // Links appear on cards and inside wells, not only on the page ground.
    expect(contrast(token('brand-ink'), token('surface-raised'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('brand-ink'), token('surface-sunken'))).toBeGreaterThanOrEqual(4.5);
  });

  it('meets AA against the soft fill it sits in when a nav item is active', () => {
    expect(contrast(token('brand-ink'), token('brand-soft'))).toBeGreaterThanOrEqual(4.5);
  });

  it('is far darker than the fill, which is the whole point of the split', () => {
    expect(token('brand-ink').l).toBeLessThan(token('brand').l - 30);
  });
});

describe('the dark theme', () => {
  it('lets the fill and the text colour finally be the same value', () => {
    // In the dark the split collapses: lime reaches ~15:1 on the dark ground.
    expect(contrast(token('dark-brand-ink'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(token('dark-brand-ink')).toEqual(token('dark-brand'));
  });

  it('still carries near-black on the lime fill', () => {
    expect(contrast(token('dark-ink-on-brand'), token('dark-brand'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('body text', () => {
  it('clears AA in both themes', () => {
    expect(contrast(token('ink'), token('surface-ground'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps muted text above the AA floor rather than merely looking quiet', () => {
    // The easiest accessibility failure in any palette: greying text down until
    // it reads as secondary, past the point where it reads at all.
    expect(contrast(token('ink-muted'), token('surface-ground'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink-muted'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe('focus rings', () => {
  it('meet the 3:1 floor for non-text indicators in both themes', () => {
    expect(contrast(token('brand-ring'), token('surface-ground'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('dark-brand-ring'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(
      3,
    );
  });
});
