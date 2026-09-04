import { ImageResponse } from 'next/og';

/**
 * The iOS home-screen icon.
 *
 * Separate from `icon.tsx` for one reason that still holds: iOS applies its own
 * rounded mask and does not composite over a background, so the lime runs edge
 * to edge here with no border radius of its own. Rounding it twice produces a
 * visible pale corner inside the mask.
 *
 * Same three rectangles, same percentages, so the two icons cannot drift.
 */

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const LIME = '#C7F04B';
const NEAR_BLACK = '#101210';

const PARTS = [
  { left: '21.41%', top: '17.66%', width: '16.25%', height: '65%' },
  { left: '37.66%', top: '66.41%', width: '35%', height: '16.25%' },
  { left: '47.66%', top: '17.66%', width: '16.25%', height: '32.5%' },
] as const;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: LIME,
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
