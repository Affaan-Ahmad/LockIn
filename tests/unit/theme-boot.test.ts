import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';
import { THEME_BOOT, THEME_BOOT_SHA256, THEME_COLORS } from '@/shared/theme-boot';

describe('theme boot script', () => {
  it.each([
    ['dark', false, '#080b08'],
    ['light', true, '#f4f4ef'],
    ['system', true, '#080b08'],
    [null, false, '#f4f4ef'],
    ['invalid', true, '#080b08'],
    ['blocked', true, '#080b08'],
  ])('aligns chrome with saved %s theme (device dark: %s)', (saved, systemDark, expected) => {
    let theme: string | null = null;
    let chrome = '';
    runInNewContext(THEME_BOOT, {
      localStorage: { getItem: () => {
        if (saved === 'blocked') throw new Error('Storage unavailable');
        return saved;
      } },
      matchMedia: () => ({ matches: systemDark }),
      document: {
        documentElement: {
          setAttribute: (_name: string, value: string) => { theme = value; },
          getAttribute: () => theme,
        },
        querySelector: () => ({ setAttribute: (_name: string, value: string) => { chrome = value; } }),
      },
    });
    expect(chrome).toBe(expected);
    expect(theme).toBe(saved === 'dark' || saved === 'light' ? saved : null);
  });

  it('matches the hash the Content-Security-Policy pins it to', () => {
    // The failure this guards is silent and specific: edit the script, forget
    // the constant, and the browser blocks it under CSP. Nothing errors
    // visibly -- the page just goes back to flashing the wrong theme before
    // correcting itself, which is exactly what the script exists to prevent.
    const digest = createHash('sha256').update(THEME_BOOT, 'utf8').digest('base64');
    expect(THEME_BOOT_SHA256).toBe(`sha256-${digest}`);
  });

  it('stays wrapped so a storage failure cannot leave the page unstyled', () => {
    // Reading localStorage throws outright in private mode and with site data
    // blocked. An unguarded throw here runs before anything else on the page.
    expect(THEME_BOOT.startsWith('try{')).toBe(true);
    expect(THEME_BOOT).toContain('catch');
  });
});

describe('installed app chrome', () => {
  /**
   * The Android status bar is the one surface the boot script cannot reach.
   *
   * Everywhere else, `<meta name="theme-color">` is corrected before first
   * paint. An installed PWA is different: Chrome bakes the manifest's
   * theme_color into the WebAPK, so whatever is written here is what the
   * student's status bar shows, in both themes, until the WebAPK is updated.
   *
   * It was the light ground, which is how a near-black app in dark mode came to
   * have an off-white strip along the top of the screen.
   */
  it('paints the installed status bar with the dark ground', () => {
    expect(manifest().theme_color).toBe(THEME_COLORS.dark);
  });

  it('keeps the splash on the light ground', () => {
    // Deliberately not the same value. background_color fills the splash, which
    // is shown before any of the app's own colour exists; theme_color is the
    // system chrome around it.
    expect(manifest().background_color).toBe(THEME_COLORS.light);
  });

  it('uses the shared constants rather than its own copies of them', () => {
    // The two were duplicated hex literals, and duplicated literals are how one
    // of them ends up wrong without the other moving.
    const source = readFileSync('src/app/manifest.ts', 'utf8');
    expect(source).toContain("from '@/shared/theme-boot'");
    expect(source).not.toMatch(/(background|theme)_color: '#/);
  });
});
