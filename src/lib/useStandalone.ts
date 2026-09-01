'use client';

import { useEffect, useState } from 'react';

/**
 * Whether LockIn is running as an installed app rather than in a browser tab.
 *
 * One place, deliberately. `matchMedia('(display-mode: standalone)')` scattered
 * through components would be four subtly different checks, and every one of
 * them is a hydration hazard: the server cannot know the answer, so any
 * component that branches on it during render disagrees with its own markup.
 *
 * Hence the shape. It returns `false` on the server and on first paint, then
 * corrects in an effect. Callers must therefore treat `true` as an
 * *enhancement* and never as a requirement: a control that only exists in
 * standalone mode would be missing for the first frame, and absent entirely for
 * everyone using a normal mobile browser.
 *
 * Layout must not depend on this. Use CSS for anything that decides where
 * things sit; use this only where installed mode genuinely behaves differently,
 * such as suppressing an install prompt that cannot apply.
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(display-mode: standalone)');

    const read = (): void => {
      // iOS Safari does not implement the display-mode media query for
      // home-screen apps and exposes a non-standard flag instead, so both are
      // checked rather than reporting a browser tab on every iPhone.
      const iosStandalone =
        'standalone' in window.navigator &&
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setStandalone(query.matches || iosStandalone);
    };

    read();
    query.addEventListener('change', read);
    return () => {
      query.removeEventListener('change', read);
    };
  }, []);

  return standalone;
}
