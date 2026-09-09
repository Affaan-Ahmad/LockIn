import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { Caveat, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';

import { THEME_BOOT } from '@/shared/theme-boot';
import { Splash } from '@/components/shell/Splash';
import { InstallWatcher } from '@/features/pwa/InstallWatcher';
import { ServiceWorkerRegistrar } from '@/features/pwa/ServiceWorkerRegistrar';
import { ThemeChrome } from '@/components/shell/ThemeChrome';
import { MotionProvider } from '@/components/ui/Motion';

import './globals.css';

/**
 * Root layout.
 *
 * Three faces, all self-hosted. `next/font/google` downloads them at build time
 * and serves them from this origin, so the Content-Security-Policy still needs
 * no fonts.gstatic.com entry and stays exactly as tight as it was written.
 *
 * Each has one job and does not take another's.
 *
 * **Instrument Sans** is the interface: everything a person reads as a label,
 * a title or a sentence.
 *
 * **IBM Plex Mono** carries times, dates, counts and section captions, always
 * with tabular figures, because a column of deadline times that does not line
 * up is a column nobody can scan.
 *
 * **Caveat** is annotation only -- the pencilled note in the margin. Never a
 * label, never data, never a control. A handwriting face used for a value is
 * the fastest way to make an interface look unserious about the value.
 *
 * **Geist** belongs to the workbench skin and is loaded beside them. Declaring
 * it here rather than lazily is not an oversight: `next/font` resolves at build
 * time, so a face can only be swapped by a stylesheet, and a skin that arrives
 * a paint late is worse than one extra self-hosted family. It is self-hosted
 * too, so the Content-Security-Policy is unchanged.
 */

const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const hand = Caveat({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-caveat',
  display: 'swap',
});

export const metadata = {
  title: 'LockIn',
  description: 'Your coursework, filtered to what is actually yours.',
  appleWebApp: { capable: true, title: 'LockIn', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays enabled. Locking it is an accessibility failure that mostly
  // hurts people who need to magnify text.
  viewportFit: 'cover' as const,
};

// No longer async, and no longer reads headers(). The boot script is
// authorised by hash, so the layout does not need the per-request nonce, and
// dropping the headers() call also drops the dynamic-rendering opt-in it forced
// on every route that renders this layout.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${hand.variable} ${GeistSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Owned here so the synchronous boot script can update it before paint. */}
        <meta name="theme-color" content="#e3dbd0" suppressHydrationWarning />
        {/* No nonce, and therefore nothing for React to compare across
            hydration. The CSP authorises this script by SHA-256 instead; see
            src/shared/theme-boot.ts for why that is both the fix and the
            stricter policy. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ThemeChrome />
        {/* First thing in the body so it paints before anything below it, and
            removed the moment the app hydrates. Only visible in the installed
            app; see the display-mode guard on .app-splash. */}
        <Splash />
        {/* Renders nothing. Mounted here because the browser's install offer
            arrives once, on load, and Settings is rarely the page that loaded. */}
        <InstallWatcher />
        <ServiceWorkerRegistrar />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
