import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { GeistSans } from 'geist/font/sans';

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
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Colour of the browser chrome on mobile. Matches the ground so the app does
  // not look like it is sitting inside a differently coloured frame.
  themeColor: [
    // The exact sRGB conversions of --surface-ground in each mode, not
    // approximations. Both were eyeballed before and both were wrong, which
    // showed as browser chrome a shade off the page below it.
    { media: '(prefers-color-scheme: light)', color: '#f6f3ed' },
    { media: '(prefers-color-scheme: dark)', color: '#080a0f' },
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
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning is correct here rather than a workaround.
          The HTML spec requires a browser to blank the `nonce` content
          attribute once the element is inserted -- getAttribute('nonce')
          returns "" while the element.nonce IDL property keeps the value --
          so that a CSS attribute selector cannot be used to exfiltrate it.

          React therefore compares nonce="..." from the server against nonce=""
          in the DOM and reports a mismatch that is not one. Nothing is broken:
          the script is synchronous and already executed during parse, which is
          the whole reason it is inline, and it executed precisely because the
          nonce was present when the parser reached it.

          The warning is suppressed on the element rather than inherited,
          because suppressHydrationWarning only applies one level deep and the
          flag on <html> does not reach here. Left unsuppressed it would print
          on every page load and train us to scroll past hydration errors,
          which is how a real one gets missed.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOT }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
