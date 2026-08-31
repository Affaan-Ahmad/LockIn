import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import './globals.css';

/**
 * Root layout.
 *
 * One font family, self-hosted by next/font. Self-hosting is not only a
 * performance choice: it means the Content-Security-Policy needs no
 * fonts.gstatic.com entry, so the policy stays as tight as it was written.
 *
 * Inter rather than a display face, deliberately. The brief asks for a small
 * font payload, and LockIn's character comes from colour, shape and surface —
 * a second family would cost real bytes for decoration the design system is
 * already providing.
 */

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  // A variable font ships one file for every weight, so restricting the axis
  // is what actually saves bytes here.
  axes: [],
});

export const metadata = {
  title: 'LockIn',
  description: 'Your coursework, filtered to what is actually yours.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Colour of the browser chrome on mobile. Matches the ground so the app does
  // not look like it is sitting inside a differently coloured frame.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f4ef' },
    { media: '(prefers-color-scheme: dark)', color: '#2b2c33' },
  ],
  // Zoom stays enabled. Locking it is an accessibility failure that mostly
  // hurts people who need to magnify text.
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
