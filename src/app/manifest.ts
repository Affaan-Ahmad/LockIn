import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * Generated rather than a static file so the colours stay tied to the design
 * tokens they come from: these are the sRGB conversions of the OKLCH ground and
 * brand values in `globals.css`, and a hand-written JSON copy would drift the
 * first time the palette was retuned.
 *
 * `display: standalone` removes the browser chrome when installed, which is
 * what makes the bottom tab bar read as a tab bar rather than as a web page
 * with a toolbar above it. The layout already reserves
 * `env(safe-area-inset-bottom)`, so the gesture area is handled.
 *
 * `start_url` is the dashboard, not the marketing page. Someone who installed
 * the app has already decided; sending them to a pitch would be a worse first
 * tap than the sign-in redirect they get if their session has lapsed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LockIn',
    short_name: 'LockIn',
    description: 'Every Google Classroom deadline that is actually yours.',
    start_url: '/',
    // Scoped to the whole origin so the legal pages open in-app rather than
    // kicking the user out to a browser tab.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches --surface-ground so the splash screen and the first paint are the
    // same colour, rather than flashing white before the app renders.
    background_color: '#f6f3ed',
    theme_color: '#f6f3ed',
    categories: ['education', 'productivity'],
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        // `any` rather than `maskable`: the mark is drawn edge to edge, and
        // declaring it maskable would let a launcher crop into the glyph.
        purpose: 'any',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
