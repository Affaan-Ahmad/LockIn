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
    //
    // The ground, not the lime. An install splash filled with a 90%-lightness
    // brand colour is a flash of near-white with a tint, which reads as a
    // rendering fault rather than as branding -- and it would not match the
    // page that appears a moment later.
    background_color: '#f4f4ef',
    theme_color: '#f4f4ef',
    categories: ['education', 'productivity'],
    // PNG, deliberately, even though the browser tab is served an SVG from
    // `icon.svg`. Android's install prompt and splash screen have never handled
    // SVG icons dependably, and an install with no icon is worse than a few
    // kilobytes of raster.
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
      {
        // Android's adaptive icon. Without a maskable entry the launcher
        // cannot crop to its own shape, so Chrome centres a shrunken copy on a
        // white plate -- a small lime square in a white circle, beside every
        // other app that fills its shape. This one runs edge to edge with the
        // mark inside the 80% safe zone, so it survives any mask.
        src: '/maskable-icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
