'use client';

import { useEffect, useState } from 'react';

import { LogoTile } from '@/components/paper';

/**
 * The installed app's loading screen.
 *
 * Android builds the launch splash from the manifest — the icon centred on
 * `background_color` — and a web app cannot replace it. So this does not try to.
 * It continues it: the same ground, the same mark, the same position, drawn by
 * us the instant the OS hands over. The seam between the two is meant to be
 * invisible, which is why the colours come from the same tokens the manifest
 * does rather than being picked to look nice here.
 *
 * Rendered on the server as part of the first paint, then removed on hydration.
 * That is the honest definition of "ready": not a timer, but the moment the
 * application is actually interactive. `useEffect` runs after the first client
 * render, so server and client agree on the first pass and nothing mismatches.
 *
 * It is invisible outside the installed app — see the `display-mode: standalone`
 * guard on `.app-splash`. A browser tab has no launch splash to continue from,
 * and a full-screen mark on every hard load would be branding for its own sake.
 *
 * The CSS carries a 2.5s fade as a failsafe. If hydration never happens — a
 * blocked script, a chunk that 404s — the splash must not become a screen the
 * student cannot get past.
 */
export function Splash() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (ready) return null;

  return (
    <div className="app-splash" role="status" aria-live="polite">
      <LogoTile size={72} />
      <p className="text-[15px] font-bold tracking-[-0.03em] text-ink">LockIn</p>
      <span className="sr-only">Loading</span>
    </div>
  );
}
