'use client';

import { useEffect, useId, useState } from 'react';

import { cx } from '@/lib/cx';

/**
 * Light, dark, or whatever the device says.
 *
 * The stylesheet has supported all three from the start: the dark palette
 * applies under `prefers-color-scheme` unless `data-theme="light"` is stamped,
 * and again when `data-theme="dark"` is. Nothing ever stamped the attribute, so
 * a student whose phone was set to dark had no way to read LockIn in light.
 * This is that missing control, not a new theme.
 *
 * "System" is a real third option, not the absence of one. Removing the
 * attribute is different from choosing light: it hands the decision back to the
 * device, which is what someone on an automatic day-night schedule wants.
 *
 * Three native radios rather than a menu component. A dropdown here cost 38 kB
 * of JavaScript on this route to pick one of three values, and a radio group
 * already ships arrow-key navigation, roving focus, forced-colours support and
 * the correct announcement, for nothing. The menu component earns its weight
 * where the accessibility is genuinely hard; this is not that.
 */

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'lockin-theme';

const OPTIONS: readonly { readonly value: Theme; readonly label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Device' },
];

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function ThemeToggle() {
  const name = useId();
  // Starts at 'system' on the server and on first paint, then corrects once
  // localStorage is readable. Reading storage during render would produce
  // markup that disagrees with the server's and trip a hydration mismatch.
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isTheme(stored)) setTheme(stored);
    } catch {
      // Private mode, or site data blocked. The device preference still works;
      // only the saved override is unavailable.
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies to this page; it just is not remembered.
    }
  }

  return (
    <fieldset className="surface-sunken flex shrink-0 gap-1 rounded-pill p-1">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <label
            key={option.value}
            className={cx(
              'relative flex min-h-9 cursor-pointer items-center rounded-pill px-3.5',
              'text-sm font-medium transition-colors duration-[120ms]',
              // Focus is drawn on the label because the input itself is
              // visually hidden; :has keeps that tied to the real focus state
              // rather than a manually tracked one.
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
              active ? 'bg-raised font-semibold text-ink shadow-raised' : 'text-ink-muted hover:text-ink',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => {
                choose(option.value);
              }}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
