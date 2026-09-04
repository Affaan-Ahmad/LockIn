import { ImageResponse } from 'next/og';

/**
 * The adaptive-icon variant, for Android launchers.
 *
 * A manifest that offers only `purpose: "any"` gets treated as a picture rather
 * than an icon: Android cannot mask it to the launcher's shape, so Chrome
 * centres a shrunken copy on a white plate. The result is a small lime square
 * floating in a white circle, next to every other app that fills its shape
 * properly.
 *
 * `purpose: "maskable"` says "crop this to whatever shape you use". Two things
 * follow, and both are why this cannot simply be `icon.tsx` with a different
 * label:
 *
 *   The background runs edge to edge with no rounded corners of its own. The
 *   launcher supplies the shape -- circle, squircle, rounded square, teardrop --
 *   and a radius baked in here would show as a pale notch inside it.
 *
 *   The mark sits inside the safe zone: the centred circle of 80% diameter that
 *   every mask is guaranteed to keep. At the scale `icon.tsx` uses, the corners
 *   of the L fall about 27.6 units from centre against a 25.6 limit, so a
 *   circular mask would clip them. Scaled to 0.62 and re-centred, the furthest
 *   corner sits at 20.5 -- comfortably inside whatever shape a launcher picks.
 *
 * Same three rectangles as the other two icons, same source geometry, different
 * transform. Everything here is derived from `M9 6h13v39h28v13H9z` plus
 * `rect x=30 y=6 w=13 h=26` on a 64 grid.
 */

export const runtime = 'nodejs';
// Static: the icon depends on nothing about the request, and a launcher that
// re-fetches it should get a cached byte-identical answer rather than a fresh
// render.
export const dynamic = 'force-static';

const LIME = '#C7F04B';
const NEAR_BLACK = '#101210';

/**
 * The mark at 0.62 scale, centred on the 64-unit artboard, as percentages.
 *
 * Percentages rather than pixels so the same numbers hold at whatever size a
 * launcher asks for.
 */
const PARTS = [
  { left: '30.14%', top: '24.81%', width: '12.59%', height: '50.38%' },
  { left: '42.73%', top: '62.59%', width: '27.13%', height: '12.59%' },
  { left: '50.48%', top: '24.81%', width: '12.59%', height: '25.19%' },
] as const;

export function GET(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          // Edge to edge, deliberately. The launcher's mask is the shape.
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
    { width: 512, height: 512 },
  );
}
