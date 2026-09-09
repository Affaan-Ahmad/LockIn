'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { PaperButton } from '@/components/paper';
import {
  getServerSnapshot,
  getSnapshot,
  isIosSafari,
  promptInstall,
  subscribe,
} from '@/features/pwa/install-store';

/**
 * Install LockIn as an app.
 *
 * Four states, because the browsers genuinely differ and pretending otherwise
 * produces a button that does nothing on half of them:
 *
 *   Already installed — say so and stop. Offering to install something that is
 *   installed is how a settings screen loses trust.
 *
 *   An offer is held — a real button, which opens the browser's own dialog.
 *   There is no API to summon that dialog on demand; the only way is the event
 *   captured on load, which is what `install-store` exists to keep.
 *
 *   iOS — Safari has never implemented the install API and never fires the
 *   event. The only honest thing is to describe the two taps, because they are
 *   not discoverable.
 *
 *   Anything else — no offer yet. Said plainly rather than shown as a dead
 *   button: Firefox does not support installing at all, and Chrome withholds the
 *   offer until it decides the site qualifies.
 */
export function InstallApp() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Resolved after mount. The server cannot know the platform, and guessing it
  // during render would mean the markup disagreed with the browser it landed in.
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIos(isIosSafari());
  }, []);

  async function install() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'dismissed') setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'installed') {
    return (
      <Panel>
        <p className="text-sm font-medium text-ink">LockIn is installed on this device.</p>
        <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
          It opens in its own window, without browser chrome, and starts on Today. Remove it the way
          you would any other app.
        </p>
      </Panel>
    );
  }

  if (state === 'ready') {
    return (
      <Panel>
        <p className="text-sm font-medium text-ink">Install LockIn</p>
        <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
          Adds it to your home screen or launcher, with its own icon, opening straight to Today
          instead of a browser tab.
        </p>
        <div className="mt-3">
          <PaperButton variant="primary" size="md" disabled={busy} onClick={() => void install()}>
            {busy ? 'Opening…' : 'Install now'}
          </PaperButton>
        </div>
        {dismissed ? (
          <p className="mt-2 text-xs text-ink-muted">
            You closed the last prompt. Your browser may take a while before offering it again.
          </p>
        ) : null}
      </Panel>
    );
  }

  if (ios) {
    return (
      <Panel>
        <p className="text-sm font-medium text-ink">Install LockIn</p>
        <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
          Safari has no install button, so this is done by hand — and it is worth doing, because an
          installed copy opens without the address bar taking a third of the screen.
        </p>
        <ol className="measure mt-3 flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-soft">
          <li>
            Tap <strong className="font-medium text-ink">Share</strong> in the toolbar.
          </li>
          <li>
            Choose <strong className="font-medium text-ink">Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong className="font-medium text-ink">Add</strong>.
          </li>
        </ol>
      </Panel>
    );
  }

  return (
    <Panel>
      <p className="text-sm font-medium text-ink">Install LockIn</p>
      <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
        Your browser has not offered an install yet. Chrome and Edge put it in the address bar or the
        three-dot menu, as <strong className="font-medium text-ink">Install LockIn</strong>; Firefox
        does not support installing web apps at all. If you have already installed it, open it from
        your home screen rather than here.
      </p>
    </Panel>
  );
}

function Panel({ children }: { readonly children: React.ReactNode }) {
  return <div className="surface-raised p-4">{children}</div>;
}
