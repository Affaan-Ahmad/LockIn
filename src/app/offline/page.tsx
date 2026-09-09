import { LogoTile } from '@/components/paper';
import { OfflineApp } from '@/features/offline/OfflineApp';

/**
 * What the installed app shows when a navigation cannot reach the server.
 *
 * Served by the service worker from its cache, so the page itself has to be
 * genuinely static: no session, no server data, nothing that assumes a network.
 * What it *can* do is read the snapshots the app left in IndexedDB on this
 * device, which is the only coursework LockIn keeps locally.
 *
 * This one file answers for every route, because the worker serves it for any
 * navigation it cannot fulfil. `OfflineApp` reads the URL to work out which
 * screen was actually wanted — `respondWith` does not rewrite the address — so
 * offline the app stays navigable instead of collapsing to a single dead end.
 *
 * Public by necessity. Someone can be both signed out and offline, and a
 * redirect to sign-in is the one thing that definitely will not work.
 */
/**
 * Rendered per request, for the nonce -- see the note in `legal/layout.tsx`.
 *
 * Being dynamic does not stop this working offline. The service worker caches
 * the whole Response, headers included, so what it replays later is that
 * render's own CSP alongside the script tags carrying that render's nonce. The
 * two match because they were minted together.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Offline · LockIn',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="grain flex min-h-dvh flex-col items-center justify-center gap-4 bg-p0 px-6 py-12 text-center">
      <LogoTile size={56} />

      <h1 className="mt-2 text-[20px] font-bold tracking-[-0.03em] text-ink">
        You&rsquo;re offline
      </h1>

      <OfflineApp />
    </main>
  );
}
