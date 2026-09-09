import { LogoTile, PaperButtonLink } from '@/components/paper';

/**
 * What the installed app shows when a navigation cannot reach the server.
 *
 * Served by the service worker from its cache, so it has to be genuinely
 * static: no session, no data, nothing that assumes a network. It is also
 * deliberately honest about what is missing — LockIn caches no coursework, so
 * there is nothing stale to fall back to, and saying "you are offline" is the
 * whole truth rather than a placeholder for content that will never arrive.
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
    <main className="grain flex min-h-dvh flex-col items-center justify-center gap-4 bg-p0 px-6 text-center">
      <LogoTile size={56} />

      <h1 className="mt-2 text-[20px] font-bold tracking-[-0.03em] text-ink">
        You&rsquo;re offline
      </h1>

      <p className="max-w-[34ch] text-[13.5px] leading-relaxed text-ink-soft">
        LockIn needs a connection to read your coursework. It deliberately keeps no copy of your
        deadlines on this device, so there is nothing to show you that would still be true.
      </p>

      <p className="max-w-[34ch] text-[12px] leading-relaxed text-ink-faint">
        Reconnect and open it again — anything that changed in Classroom will be picked up on the
        next sync.
      </p>

      <PaperButtonLink href="/" variant="secondary" size="md" className="mt-2">
        Try again
      </PaperButtonLink>
    </main>
  );
}
