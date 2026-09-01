import { ImageResponse } from 'next/og';

/**
 * The iOS home-screen icon.
 *
 * Separate from `icon.tsx` because iOS applies its own rounded mask and does
 * not composite over a background, so the mark is drawn edge to edge at the
 * size iOS actually requests rather than being scaled from the 512px one.
 */

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 108,
          fontWeight: 600,
          letterSpacing: '-0.05em',
        }}
      >
        L
      </div>
    ),
    size,
  );
}
