'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, in production only.
 *
 * Renders nothing.
 *
 * Development is excluded deliberately. A worker that caches build output while
 * that output is being rebuilt every few seconds serves yesterday's chunk and
 * turns every "why did my change not appear" into a cache hunt.
 *
 * Registration is also deferred to `load`. It competes with the page's own
 * scripts for bandwidth on a cold start, and the worker is worth nothing on
 * this visit anyway — its whole benefit is the next launch.
 *
 * See `public/sw.js` for what is cached and, more importantly, what is not.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration costs the student nothing: every request simply
        // goes to the network, which is what happens without a worker at all.
        // It is not worth an error in front of them.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return undefined;
    }

    window.addEventListener('load', register);
    return () => {
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
