import { ImageResponse } from 'next/og';

/**
 * The 512px PNG app icon, for installers.
 *
 * NOT the browser favicon -- `icon.svg` beside this file wins that, and Next
 * links only the SVG in the document head. Both are kept on purpose:
 *
 *   The tab wants an SVG. It renders crisp at 16px and at any device pixel
 *   ratio, where a 512px PNG is resampled down to roughly a 2px stem and goes
 *   soft.
 *
 *   The manifest wants a PNG. Android's install prompt and splash screen have
 *   never handled SVG icons reliably, so `/icon` stays a real raster image and
 *   `manifest.ts` points at it.
 *
 * Deleting either one breaks a surface that the other does not cover.
 *
 * Generated at build time rather than checked in as a binary, so the mark and
 * the palette cannot drift apart and there is no asset to re-export when a
 * colour changes.
 *
 * Drawn as three rectangles rather than as an SVG path. Satori -- the renderer
 * behind ImageResponse -- has patchy support for inline SVG, and this mark is
 * genuinely three rectangles: the stem, the foot, and the detached bar that
 * makes the L read as LI. Positions are the source geometry
 * (`M9 6h13v39h28v13H9z` plus `rect x=30 y=6 w=13 h=26` on a 64 grid) put
 * through the same `translate(6.5 6.5) scale(0.8)` the brand kit uses, then
 * expressed as percentages so it is resolution-independent.
 *
 * Dark on lime, not lime on dark. On a home screen full of other icons the lime
 * block is what gets spotted; burying it inside a dark square hides the one
 * memorable thing about the mark.
 */

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

const LIME = '#C7F04B';
const NEAR_BLACK = '#101210';

/** The three parts, as percentages of the icon's own box. */
const PARTS = [
  { left: '21.41%', top: '17.66%', width: '16.25%', height: '65%' },
  { left: '37.66%', top: '66.41%', width: '35%', height: '16.25%' },
  { left: '47.66%', top: '17.66%', width: '16.25%', height: '32.5%' },
] as const;

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: LIME,
          // 14/64 of the source artboard, kept as a ratio so it survives any
          // size this is rendered at.
          borderRadius: '21.875%',
        }}
      >
        {PARTS.map((part) => (
          <div
            key={part.left + part.top}
            style={{ position: 'absolute', background: NEAR_BLACK, ...part }}
          />
        ))}
      </div>
    ),
    size,
  );
}
