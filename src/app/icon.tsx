import { ImageResponse } from 'next/og';

/**
 * The app icon.
 *
 * Generated at build time from the brand tokens rather than checked in as a
 * binary, so the mark cannot drift from the palette and there is no asset to
 * re-export when the colour changes. `#4e61de` is the sRGB conversion of
 * `oklch(55% 0.19 272)`, the brand iris.
 *
 * Deliberately a plain monogram. An icon is seen at 48px on a home screen
 * beside twenty others, where detail is invisible and only the silhouette and
 * the colour register; anything more elaborate would be work nobody can see.
 */

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#4e61de',
          color: '#fbfcff',
          fontSize: 300,
          fontWeight: 600,
          // Tightened the way the wordmark is, so the icon and the header read
          // as the same brand.
          letterSpacing: '-0.05em',
        }}
      >
        L
      </div>
    ),
    size,
  );
}
