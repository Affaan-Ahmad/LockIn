import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { THEME_BOOT, THEME_BOOT_SHA256 } from '@/shared/theme-boot';

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
