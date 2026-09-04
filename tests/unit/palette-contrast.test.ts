import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Contrast guarantees for the brand palette.
 *
 * These exist because the brand is a 90%-lightness lime, which is legible on
 * almost nothing. Every other colour in the system tolerates being used in the
 * wrong role and merely looks slightly off; lime measures 1.2:1 both as text on
 * the page and as a fill behind it, and in either case the thing is simply
 * gone. Nothing in TypeScript, ESLint or the build catches that.
 *
 * Two distinct questions are asked of every fill, and the first version of this
 * suite only asked one of them:
 *
 *   Can the LABEL be read on the fill?  (>= 4.5:1)
 *   Can the FILL be seen on the page?   (>= 3:1, WCAG 1.4.11)
 *
 * A lime button passed the first and failed the second at 1.19:1 -- a perfectly
 * legible label on a control with no edge and no presence. That shipped, and it
 * is why the second question is now asked out loud.
 *
 * Ratios are computed from the real token values parsed out of globals.css, so
 * a retune that breaks either question fails here rather than in front of a
 * student.
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

describe('the emphatic fill', () => {
  it('carries a label that can be read on it', () => {
    // The two halves of the mark, whichever way round the theme puts them.
    expect(contrast(token('ink-on-brand'), token('brand'))).toBeGreaterThanOrEqual(4.5);
  });

  it('stays readable on its hover state too', () => {
    expect(contrast(token('ink-on-brand'), token('brand-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('separates from the page it sits on', () => {
    // The check this suite was missing, and the one that mattered. A filled
    // button whose fill matches the page luminance has no edge and no
    // presence -- the label can be perfectly legible while the control is
    // invisible as a control. WCAG 1.4.11 asks 3:1 for a UI component against
    // adjacent colour; a lime fill on the cream ground managed 1.19:1.
    expect(contrast(token('brand'), token('surface-ground'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('brand'), token('surface-raised'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('dark-brand'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps its hover state separated from the page as well', () => {
    // A hover that dissolves into the background is a hover that reads as the
    // button being disabled.
    expect(contrast(token('brand-hover'), token('surface-ground'))).toBeGreaterThanOrEqual(3);
    expect(
      contrast(token('dark-brand-hover'), token('dark-surface-ground')),
    ).toBeGreaterThanOrEqual(3);
  });

  it('pairs the two halves of the mark, never white', () => {
    // Whichever way round the pair sits, white lands on one half at ~1.3:1.
    const white = { l: 100, c: 0, h: 0 };
    expect(contrast(white, token('brand'))).not.toBeLessThan(4.5);
    expect(contrast(white, token('dark-brand'))).toBeLessThan(4.5);
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

  it('stays recognisably the mark’s hue rather than a generic green', () => {
    // The lightness relationship to --brand is not the invariant: --brand
    // inverts per theme, so comparing the two says nothing. What must hold is
    // that brand-coloured text still reads as *this* brand -- same hue family
    // as the lime, with enough chroma to be a colour rather than a grey.
    const lime = token('dark-brand');
    const ink = token('brand-ink');
    expect(Math.abs(ink.h - lime.h)).toBeLessThanOrEqual(20);
    expect(ink.c).toBeGreaterThan(0.08);
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

describe('semantic fills', () => {
  // danger and review carry the same one-token-two-roles hazard the brand had:
  // each is a fill AND a text colour, and the dark theme lifts them to ~70%
  // lightness so the text role stays legible. That makes white unreadable on
  // them, which is why the label flips with the theme.
  it.each(['danger', 'review'] as const)(
    'carries a readable label on %s in the light theme',
    (name) => {
      expect(contrast(token('ink-on-fill'), token(name))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['danger', 'review'] as const)(
    'carries a readable label on %s in the dark theme',
    (name) => {
      expect(contrast(token('dark-ink-on-fill'), token(`dark-${name}`))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it('would fail with a fixed white label, which is why the token flips', () => {
    // Guards the reasoning, not just the result: if someone reverts these call
    // sites to text-white, this records what that costs in the dark theme.
    const white = { l: 100, c: 0, h: 0 };
    expect(contrast(white, token('dark-danger'))).toBeLessThan(4.5);
    expect(contrast(white, token('dark-review'))).toBeLessThan(4.5);
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
