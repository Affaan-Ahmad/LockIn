import type { ReactNode } from 'react';
import { headers } from 'next/headers';
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
    // Re-measured against the deepened ground. Left at the old value the
    // browser chrome sat visibly lighter than the page below it.
    { media: '(prefers-color-scheme: dark)', color: '#1c1d23' },
  ],
  // Zoom stays enabled. Locking it is an accessibility failure that mostly
  // hurts people who need to magnify text.
  viewportFit: 'cover' as const,
};

/**
 * Applies a saved theme before the first paint.
 *
 * Has to be inline and synchronous. Anything deferred, including a React
 * effect, runs after the browser has already painted, so a student who chose
 * light on a dark-set phone would see a dark page flash first. That flash is
 * the entire problem this solves.
 *
 * Reading storage can throw outright in private mode or with site data
 * blocked, so the whole body is wrapped: a failure here must leave the device
 * preference in charge, not leave the page unstyled.
 */
const THEME_BOOT = `try{var t=localStorage.getItem('lockin-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The nonce the middleware minted for this request. The CSP is nonce-based
  // with strict-dynamic, so an inline script without it is blocked, and a
  // blocked boot script is exactly the flash above.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
