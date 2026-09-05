'use client';

import { useEffect } from 'react';
import { THEME_COLORS } from '@/shared/theme-boot';

/** Keep installed-app chrome aligned with explicit choices and device changes. */
export function ThemeChrome() {
  useEffect(() => {
    const root = document.documentElement;
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = root.getAttribute('data-theme');
      const dark = theme === 'dark' || (theme !== 'light' && system.matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);
    };
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    system.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      system.removeEventListener('change', update);
    };
  }, []);
  return null;
}
