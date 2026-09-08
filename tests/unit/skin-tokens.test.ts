import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The two skins, checked at the token layer.
 *
 * LockIn ships two front ends. Paper is the default and owns the vocabulary
 * every shared component is written in -- `bg-p3`, `shadow-lift-2`, `text-terra`
 * -- and the workbench skin restates that whole vocabulary in its own values so
 * one component can serve both.
 *
 * That arrangement has exactly one failure mode, and it is silent. Add a paper
 * token, use it in a shared component, forget to map it, and the workbench
 * renders a warm paper colour in the middle of its cool near-white ground. No
 * build error, no type error, no test -- just one wrong swatch that nobody
 * looking at the default skin will ever see.
 *
 * So the mapping is asserted to be total rather than trusted to be remembered.
 */

const CSS = readFileSync('src/app/globals.css', 'utf8');

/** The paper declarations, i.e. everything above the workbench section. */
const PAPER = CSS.slice(0, CSS.indexOf('The workbench skin.'));

/** A `[data-skin='workbench']` block, by the selector that opens it. */
function skinBlock(selector: string): string {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} not found`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('\n}', open);
  return CSS.slice(open, close);
}

const LIGHT = skinBlock("[data-skin='workbench'] {");
const DARK_MEDIA = skinBlock(":root:not([data-theme='light']) [data-skin='workbench'] {");
const DARK_EXPLICIT = skinBlock(":root[data-theme='dark'] [data-skin='workbench'] {");

/**
 * Paper's own material vocabulary: the tokens the previous design never had.
 *
 * Derived from the stylesheet rather than typed out, so a token added tomorrow
 * is covered by this suite the moment it is declared.
 */
function paperOnlyTokens(): readonly string[] {
  const declared = new Set(
    [...PAPER.matchAll(/^\s*--([A-Za-z0-9-]+)\s*:/gm)].map((match) => match[1] as string),
  );

  // The material vocabulary, by prefix. Spacing, durations, type and layout are
  // deliberately shared between the skins -- a 16px gap is 16px in both designs
  // -- so only the things that carry colour, depth or texture are checked.
  const material = /^(p[0-3]|kraft|kraft-2|kraft-3|edge|edge-soft|glow|glow-deep|terra|moss|slate|ink-faint|lift-[0-4]|press|grain)$/;

  return [...declared].filter((name) => material.test(name)).sort();
}

describe('the workbench skin', () => {
  const tokens = paperOnlyTokens();

  it('covers a vocabulary large enough to be worth checking', () => {
    // A guard on the guard: if the regex above ever stops matching, every
    // `it.each` below would silently pass zero cases.
    expect(tokens.length).toBeGreaterThanOrEqual(20);
  });

  it.each(paperOnlyTokens())('restates --%s in its own values', (name) => {
    expect(LIGHT, `--${name} is unmapped, so the workbench shows paper's value`).toContain(
      `--${name}:`,
    );
  });

  /**
   * Both dark selectors, because they are separate blocks that have to agree.
   *
   * One is the system preference and one is an explicit choice, and a token
   * present in only one of them produces a skin that changes colour depending on
   * *how* the reader arrived at dark mode -- which is the kind of bug nobody
   * reproduces on purpose.
   */
  it.each(paperOnlyTokens())('carries --%s into both dark paths', (name) => {
    expect(DARK_MEDIA, `--${name} missing from the system-preference dark block`).toContain(
      `--${name}:`,
    );
    expect(DARK_EXPLICIT, `--${name} missing from the explicit dark block`).toContain(
      `--${name}:`,
    );
  });

  /**
   * Every value the skin points at has to exist.
   *
   * `var(--wb-does-not-exist)` is not an error in CSS. It resolves to nothing,
   * the property falls back to its inherited value, and the result is a page
   * that looks *almost* right -- which is worse than one that looks broken.
   */
  it('points only at workbench values that are actually declared', () => {
    const declared = new Set(
      [...CSS.matchAll(/^\s*--(wb-[A-Za-z0-9-]+)\s*:/gm)].map((match) => match[1] as string),
    );
    expect(declared.size).toBeGreaterThan(60);

    for (const block of [LIGHT, DARK_MEDIA, DARK_EXPLICIT]) {
      for (const match of block.matchAll(/var\(--(wb-[A-Za-z0-9-]+)\)/g)) {
        expect(declared, `--${match[1] as string} is referenced but never declared`).toContain(
          match[1] as string,
        );
      }
    }
  });

  /**
   * The skin attribute stays off `<html>`.
   *
   * Reading a cookie in the root layout opts every route that renders it into
   * dynamic rendering, including the four legal pages -- which are deliberately
   * static and are read by people with no session and no cookie at all. The
   * attribute therefore lives on each shell's root element, and the selectors
   * have to be written as descendants to match.
   */
  it('scopes itself below the document element', () => {
    expect(CSS).not.toContain(":root[data-skin=");
    expect(CSS).toContain("[data-skin='workbench'] {");
  });
});
