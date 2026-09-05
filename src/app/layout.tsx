import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';

import { THEME_BOOT } from '@/shared/theme-boot';
import { ThemeChrome } from '@/components/shell/ThemeChrome';
import { MotionProvider } from '@/components/ui/Motion';

import './globals.css';

/**
 * Root layout.
 *
 * One font family, self-hosted. Self-hosting is not only a performance choice:
 * it means the Content-Security-Policy needs no fonts.gstatic.com entry, so the
 * policy stays as tight as it was written.
 *
 * Geist rather than Inter. Inter is the default of every generated interface
 * and of most of the products LockIn sits beside, which is the opposite of what
 * the brief asked for. Geist is quieter at the 13px this interface mostly lives
 * at, its numerals are unambiguous at a glance, and it ships tabular figures,
 * which matters when a column of deadline times has to line up.
 *
 * Still one family. LockIn's character comes from colour, shape and surface; a
 * display face would cost real bytes for decoration the design system already
 * provides.
 */

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
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        {/* Owned here so the synchronous boot script can update it before paint. */}
        <meta name="theme-color" content="#f4f4ef" suppressHydrationWarning />
        {/* No nonce, and therefore nothing for React to compare across
            hydration. The CSP authorises this script by SHA-256 instead; see
            src/shared/theme-boot.ts for why that is both the fix and the
            stricter policy. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body><ThemeChrome /><MotionProvider>{children}</MotionProvider></body>
    </html>
  );
}
