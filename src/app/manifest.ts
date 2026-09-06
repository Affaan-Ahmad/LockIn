import type { MetadataRoute } from 'next';

import { THEME_COLORS } from '@/shared/theme-boot';

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
/**
 * Bumped by hand when an icon's pixels change.
 *
 * The icon routes are static and their paths never move, and Vercel serves them
 * `immutable` with a one-year max-age -- correct for a byte-stable asset, and
 * the reason a wrong icon can outlive the deploy that fixed it. An installed
 * Android app is minted once from these URLs; Chrome decides whether to refresh
 * it by diffing the manifest, so an unchanged URL reads as an unchanged icon
 * and nothing is re-fetched, however wrong the copy it already has.
 *
 * Appending the revision makes the URL itself the thing that changed, so the
 * next manifest check re-downloads rather than trusting what it cached.
 *
 * It is not the app version: icons change far less often than releases do, and
 * tying the two would re-mint the installed app on every deploy for nothing.
 */
const ICON_REVISION = '2';

/** The icon's URL at the current revision. */
function ic(path: string): string {
  return `${path}?v=${ICON_REVISION}`;
}

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
    // Both come from THEME_COLORS rather than being typed out, so they cannot
    // drift from the values the boot script writes into the theme-color meta
    // tag. They were duplicated hex literals before, and one of them was wrong.
    //
    // The ground, not the lime. An install splash filled with a 90%-lightness
    // brand colour is a flash of near-white with a tint, which reads as a
    // rendering fault rather than as branding -- and it would not match the
    // page that appears a moment later.
    background_color: THEME_COLORS.light,
    // The dark ground, even though the app is not dark by default.
    //
    // This is the Android status bar, and it is the one colour on the page that
    // no script can correct. A manifest carries a single theme_color with no
    // dark variant -- the standards issue asking for one is still open -- and
    // Chrome bakes the value into the installed WebAPK, where the meta tag that
    // governs every other surface does not reach it. So it is one colour for
    // both themes, and the only question is which way to be wrong.
    //
    // Dark, because the two failures are not equally bad. A dark status bar
    // above a light app is what most Android apps look like and reads as
    // deliberate. An off-white strip above a near-black app reads as a
    // rendering fault -- which is exactly how it was reported.
    theme_color: THEME_COLORS.dark,
    categories: ['education', 'productivity'],
    // PNG, deliberately, even though the browser tab is served an SVG from
    // `icon.svg`. Android's install prompt and splash screen have never handled
    // SVG icons dependably, and an install with no icon is worse than a few
    // kilobytes of raster.
    icons: [
      {
        src: ic('/icon'),
        sizes: '512x512',
        type: 'image/png',
        // `any` rather than `maskable`: the mark is drawn edge to edge, and
        // declaring it maskable would let a launcher crop into the glyph.
        purpose: 'any',
      },
      {
        src: ic('/apple-icon'),
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
        src: ic('/maskable-icon'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
