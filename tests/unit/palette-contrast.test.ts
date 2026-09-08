import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Contrast and material guarantees for the paper palette.
 *
 * The system is six sheets stacked in near-white (or, in the dark, near-black),
 * and it has two failure modes that nothing in TypeScript, ESLint or the build
 * can see.
 *
 * **Sheets converge.** The whole premise is that every surface sits on a
 * visible sheet below it. Retune two adjacent sheets a few percent closer and
 * the stack silently flattens into one grey field -- every card still renders,
 * nothing errors, and the design is simply gone.
 *
 * **Glow escapes its gap.** `--glow` is a light warm yellow that measures under
 * 2:1 on any sheet. It is legible as nothing. The system only ever uses it as a
 * blurred pool *under* a forward layer, and the moment somebody reaches for it
 * as a border or a label it disappears.
 *
 * Two questions are asked of every fill, because the first version of the
 * previous suite only asked one:
 *
 *   Can the LABEL be read on the fill?  (>= 4.5:1)
 *   Can the FILL be seen on the page?   (>= 3:1, WCAG 1.4.11)
 *
 * Ratios are computed from the real token values parsed out of globals.css.
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

const SHEETS = ['p0', 'p1', 'p2', 'p3'] as const;

describe('the sheets stay separate sheets', () => {
  /**
   * The load-bearing invariant of the whole system. Contrast ratio is the wrong
   * instrument here -- four near-whites are all within 1.2:1 of each other by
   * definition -- so this measures the thing that actually reads as a layer:
   * the lightness step between one sheet and the next.
   */
  it('keeps a visible lightness step between each sheet and the one below', () => {
    for (const [below, above] of [
      ['p0', 'p1'],
      ['p1', 'p2'],
      ['p2', 'p3'],
    ] as const) {
      const step = token(above).l - token(below).l;
      expect(step, `${below} -> ${above}`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('stacks upward in the light and upward in the dark, never inverting', () => {
    // Dark is not an inversion: a sheet nearer the viewer is still lighter.
    for (const prefix of ['', 'dark-']) {
      const values = SHEETS.map((sheet) => token(`${prefix}${sheet}`).l);
      expect([...values].sort((a, b) => a - b), `${prefix || 'light'} sheets`).toEqual(values);
    }
  });

  it('separates the furthest sheets enough to read as a stack, not a gradient', () => {
    expect(token('p3').l - token('p0').l).toBeGreaterThanOrEqual(6);
    expect(token('dark-p3').l - token('dark-p0').l).toBeGreaterThanOrEqual(6);
  });
});

describe('text on paper', () => {
  it.each(SHEETS)('body ink clears AA on %s', (sheet) => {
    expect(contrast(token('ink'), token(sheet))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink'), token(`dark-${sheet}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SHEETS)('secondary ink clears AA on %s', (sheet) => {
    expect(contrast(token('ink-soft'), token(sheet))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink-soft'), token(`dark-${sheet}`))).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The easiest accessibility failure in any palette: greying a caption down
   * until it reads as secondary, past the point where it reads at all. Mono
   * captions are the smallest text in the system, so this one matters most.
   */
  it.each(SHEETS)('faint ink is quiet but still legible on %s', (sheet) => {
    expect(contrast(token('ink-faint'), token(sheet))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink-faint'), token(`dark-${sheet}`))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the primary button', () => {
  it('carries a label that can be read on the kraft fill', () => {
    expect(contrast(token('ink-on-brand'), token('kraft'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink-on-brand'), token('dark-kraft'))).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The second question, answered honestly.
   *
   * Kraft is a pale board colour: measured against the sheets it can sit on it
   * reaches 1.42:1 on p0 and only 1.86:1 on p3, and its kraft-2 border tops out
   * at 2.49:1. Neither clears the 3:1 that WCAG 1.4.11 asks of a control's
   * boundary. What defines this button is the border plus the stacked-sheet
   * shadow, and a shadow cannot be measured this way.
   *
   * This is recorded rather than asserted away. The previous palette shipped a
   * lime button at 1.19:1 because nobody had written the number down; writing
   * it down is what turns a deviation into a decision.
   */
  it('relies on its border and its shadow, not on fill contrast', () => {
    for (const sheet of SHEETS) {
      expect(contrast(token('kraft'), token(sheet)), `kraft on ${sheet}`).toBeLessThan(3);
    }
    // The border is the strongest edge available, so it must be meaningfully
    // darker than both the face and every sheet behind it.
    expect(token('kraft-2').l).toBeLessThan(token('kraft').l - 5);
    for (const sheet of SHEETS) {
      expect(token('kraft-2').l, `kraft-2 vs ${sheet}`).toBeLessThan(token(sheet).l - 10);
    }
  });

  it('keeps its border darker than its face, so the edge survives', () => {
    expect(token('kraft-2').l).toBeLessThan(token('kraft').l);
    expect(token('dark-kraft-2').l).toBeGreaterThan(token('dark-kraft').l);
  });
});

describe('kraft as a text colour', () => {
  /**
   * Kraft has the same one-token-two-roles hazard the previous brand had: the
   * fill is a pale board colour, and the text version has to be a much darker
   * member of the same family rather than the same value used twice.
   */
  it('reads as body text on the sheets it is printed on', () => {
    // p0 is a ground for sheets to sit on, not a surface text is set on -- see
    // the deviation recorded below.
    for (const sheet of ['p1', 'p2', 'p3'] as const) {
      expect(contrast(token('kraft-3'), token(sheet)), `kraft-3 on ${sheet}`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(token('dark-kraft-3'), token(`dark-${sheet}`))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stays in the kraft family rather than drifting to a neutral brown', () => {
    expect(Math.abs(token('kraft-3').h - token('kraft').h)).toBeLessThanOrEqual(20);
    expect(token('kraft-3').c).toBeGreaterThan(0.03);
  });
});

describe('glow only lives in a gap', () => {
  /**
   * Not a style rule with a test bolted on -- this records why the rule exists.
   * Glow is a backlight. Both values fail as text by a wide margin, so if
   * somebody reaches for one as a label or a border, this says what it costs.
   */
  it.each(['glow', 'glow-deep'] as const)('%s is unusable as text, which is the point', (name) => {
    expect(contrast(token(name), token('p3'))).toBeLessThan(3);
    expect(contrast(token(name), token('p2'))).toBeLessThan(3);
  });

  it('is warm enough to read as light rather than as a grey wash', () => {
    expect(token('glow').c).toBeGreaterThan(0.06);
    expect(token('glow-deep').c).toBeGreaterThan(token('glow').c);
  });
});

describe('semantic colours', () => {
  const SEMANTIC = ['terra', 'moss', 'slate'] as const;

  it.each(SEMANTIC)('%s reads as text on the card sheets', (name) => {
    for (const sheet of ['p2', 'p3'] as const) {
      expect(contrast(token(name), token(sheet)), `${name} on ${sheet}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token(`dark-${name}`), token('dark-p3'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SEMANTIC)('%s is visible as a status bar against the sheet behind it', (name) => {
    // A 4-5px left bar is a non-text indicator: WCAG 1.4.11, 3:1.
    expect(contrast(token(name), token('p3'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(`dark-${name}`), token('dark-p3'))).toBeGreaterThanOrEqual(3);
  });

  it('carries a readable label on the review badge in both themes', () => {
    expect(contrast(token('ink-on-fill'), token('slate'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink-on-fill'), token('dark-slate'))).toBeGreaterThanOrEqual(4.5);
  });

  it('would fail with a fixed white label, which is why the token flips', () => {
    // Guards the reasoning, not just the result. In the dark theme the semantic
    // colours lift to ~73% lightness so they still read as text, and white on
    // them is unreadable.
    const white = { l: 100, c: 0, h: 0 };
    expect(contrast(white, token('dark-terra'))).toBeLessThan(4.5);
    expect(contrast(white, token('dark-slate'))).toBeLessThan(4.5);
  });

  it('keeps red for lateness alone', () => {
    // "Red means late. Nothing else is red." Hue 42 is the terra family; moss
    // and slate must be nowhere near it.
    expect(Math.abs(token('moss').h - token('terra').h)).toBeGreaterThan(60);
    expect(Math.abs(token('slate').h - token('terra').h)).toBeGreaterThan(60);
  });
});

describe('focus rings', () => {
  it('meet the 3:1 floor for non-text indicators on every sheet', () => {
    for (const sheet of SHEETS) {
      expect(contrast(token('brand-ring'), token(sheet)), `ring on ${sheet}`).toBeGreaterThanOrEqual(
        3,
      );
      expect(contrast(token('dark-brand-ring'), token(`dark-${sheet}`))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the role aliases still point somewhere sensible', () => {
  /**
   * Screens written before this palette use the role names -- `bg-raised`,
   * `text-ink-muted`, `border-line`. They inherit the paper materials through
   * these aliases, so the aliases have to keep meeting the same floors the
   * materials do.
   */
  it('maps the raised surface to a sheet, not to something in between', () => {
    expect(token('surface-raised')).toEqual(token('p3'));
    expect(token('surface-ground')).toEqual(token('p0'));
    expect(token('surface-sunken')).toEqual(token('p1'));
  });

  it('keeps body and muted text legible on the aliased surfaces', () => {
    expect(contrast(token('ink'), token('surface-ground'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-muted'), token('surface-ground'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('dark-ink-muted'), token('dark-surface-ground'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('keeps the divider visible without becoming a drawn-on line', () => {
    expect(contrast(token('line'), token('surface-raised'))).toBeGreaterThan(1.1);
    expect(contrast(token('line-strong'), token('surface-raised'))).toBeGreaterThan(
      contrast(token('line'), token('surface-raised')),
    );
  });
});

describe('where this palette runs out', () => {
  /**
   * Deliberate limits, written down with their measured values so that using a
   * colour outside them is a choice somebody made rather than something that
   * quietly happened.
   *
   * The sand ground is the darkest sheet in the light theme, and it eats the
   * mid-tone colours: on p0, kraft-3 and terra land at 4.08:1 and moss at
   * 3.90:1 -- all under AA. Every one of them clears AA the moment it is set on
   * a card instead, which is where the design actually puts them.
   */
  it('will not carry mid-tone text directly on the sand ground', () => {
    for (const name of ['kraft-3', 'terra', 'moss'] as const) {
      expect(contrast(token(name), token('p0')), `${name} on p0`).toBeLessThan(4.5);
    }
  });

  it('carries all of them once they are on a card', () => {
    for (const name of ['kraft-3', 'terra', 'moss', 'slate'] as const) {
      expect(contrast(token(name), token('p3')), `${name} on p3`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /** Moss is the weakest of the three and only clears AA from p2 upward. */
  it('places moss no lower than the ivory sheet', () => {
    expect(contrast(token('moss'), token('p1'))).toBeLessThan(4.5);
    expect(contrast(token('moss'), token('p2'))).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * The status chip.
 *
 * `Badge` is one shape in six tones: a parchment chip on p1 with a 3px marker
 * down its leading edge. The tone is therefore expressed twice -- once in the
 * label's ink and once in the marker -- and those two have different bars to
 * clear. The ink is text (4.5:1); the marker is a non-text indicator (3:1,
 * WCAG 1.4.11).
 *
 * This exists because the tinted-fill chips this replaced were never measured.
 * Two of the six tones cannot carry their own hue as text on p1, which is only
 * discoverable by doing the arithmetic -- so the arithmetic lives here, and
 * `Badge.tsx` cites it.
 */
describe('the status chip', () => {
  /** Every tone's label ink, exactly as `Badge.tsx` sets it. */
  const CHIP_INK = ['ink-soft', 'kraft-3', 'ink-soft', 'ink-soft', 'terra', 'slate'] as const;
  /** The markers it actually paints. Three tones deliberately have none. */
  const CHIP_MARKER = ['kraft-3', 'moss', 'terra', 'slate'] as const;

  it.each([...new Set(CHIP_INK)])('sets %s as readable text on the chip', (ink) => {
    expect(contrast(token(ink), token('p1')), `${ink} on p1`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(`dark-${ink}`), token('dark-p1'))).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The values the chip deliberately does not set in its own hue.
   *
   * Recorded as assertions rather than comments: if moss is ever retuned
   * upward, this test fails and tells whoever did it that the chip may now use
   * it as ink -- which is a nicer failure than a silent 4.41:1 shipping.
   */
  it('keeps moss and glow out of its ink, because neither clears AA on it', () => {
    expect(contrast(token('moss'), token('p1'))).toBeLessThan(4.5);
    expect(contrast(token('glow-deep'), token('p1'))).toBeLessThan(4.5);
  });

  /**
   * And the ones it will not use as a marker either.
   *
   * A 3px bar at 1.9:1 or 1.5:1 is not a subtle signal, it is an absent one. The
   * chip drops the marker for those tones rather than painting something nobody
   * can see, and every chip states its meaning in words regardless.
   */
  it('paints no marker in the values that cannot be seen on it', () => {
    for (const name of ['edge', 'kraft-2', 'glow-deep', 'glow'] as const) {
      expect(contrast(token(name), token('p1')), `${name} on p1`).toBeLessThan(3);
    }
  });

  it.each([...new Set(CHIP_MARKER)])('shows the %s marker against the chip', (marker) => {
    expect(contrast(token(marker), token('p1')), `${marker} on p1`).toBeGreaterThanOrEqual(3);
    expect(contrast(token(`dark-${marker}`), token('dark-p1'))).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Where the glow is used as an edge rather than as light -- recorded, not fixed.
 *
 * `LayeredCard status="glow-deep"` paints a 4-5px bar on a card, and the
 * deadline list does the same through `[data-urgency]`. In the dark theme that
 * bar is emphatic (7.08:1 on the chip's own sheet). In the light theme it
 * measures 1.70:1 on p3: technically present, practically invisible.
 *
 * This is left alone rather than quietly recoloured, for two reasons. Nothing
 * depends on it alone -- every row that carries the bar also states its due
 * time in words beside it -- and the alternative is worse: an ink-weight amber
 * dark enough to clear 3:1 lands within about 26 degrees of hue and 1.1:1 of
 * luminance of `terra`, which would put "due today" and "late" within a glance
 * of each other. Red meaning late and nothing else is worth more than a visible
 * amber bar.
 *
 * The number is written down so the trade is a decision rather than an
 * accident. If the glow is ever retuned darker, this test fails and says so.
 */
describe('the glow used as an edge', () => {
  it('is close to invisible in the light theme, and emphatic in the dark', () => {
    expect(contrast(token('glow-deep'), token('p3'))).toBeLessThan(2);
    expect(contrast(token('dark-glow-deep'), token('dark-p3'))).toBeGreaterThanOrEqual(4.5);
  });

  it('never stands alone: terra and moss, which do clear 3:1, carry the states that matter', () => {
    expect(contrast(token('terra'), token('p3'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('moss'), token('p3'))).toBeGreaterThanOrEqual(3);
  });
});
