import { LogoTile } from '@/components/paper';
import { OfflineCoursework } from '@/features/offline/OfflineCoursework';

/**
 * What the installed app shows when a navigation cannot reach the server.
 *
 * Served by the service worker from its cache, so the page itself has to be
 * genuinely static: no session, no server data, nothing that assumes a network.
 * What it *can* do is read the snapshot the Today screen left in IndexedDB on
 * this device, which is the only coursework LockIn keeps locally.
 *
 * The wording is the careful part. This is a memory, not a reading, and every
 * line is written so that cannot be misread — see `OfflineCoursework`.
 *
 * Public by necessity. Someone can be both signed out and offline, and a
 * redirect to sign-in is the one thing that definitely will not work.
 */
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

      <OfflineCoursework />
    </main>
  );
}
