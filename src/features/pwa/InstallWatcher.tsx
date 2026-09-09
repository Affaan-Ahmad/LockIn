'use client';

import { useEffect } from 'react';

import { startWatching } from './install-store';

/**
 * Catches the browser's install offer, app-wide.
 *
 * Renders nothing. It exists only to be mounted in the root layout, because
 * `beforeinstallprompt` fires once shortly after the page loads and the Settings
 * screen is almost never the page that was loaded — Next.js navigates on the
 * client, so arriving at Settings from Today mounts a component long after the
 * event has come and gone.
 *
 * See `install-store.ts` for why the event has to be kept rather than requested.
 */
export function InstallWatcher() {
  useEffect(() => startWatching(), []);
  return null;
}
