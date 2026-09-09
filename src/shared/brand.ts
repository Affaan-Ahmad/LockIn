/**
 * The mark, as literal colour.
 *
 * Every other colour in the product is an OKLCH token in `globals.css` that the
 * browser resolves. These four surfaces cannot use those: the icons are rendered
 * by Satori at build time with no stylesheet, `icon.svg` is a standalone file,
 * and the manifest is JSON. So the mark's colours have to exist as sRGB
 * literals somewhere — and if that somewhere is four separate files, they drift,
 * which is exactly what happened when the palette moved from lime to paper and
 * the icons did not.
 *
 * These are the sRGB conversions of `--kraft` and `--ink` from the paper
 * palette. If those tokens are retuned, these follow by hand, and the comment
 * above each says which token it came from so the conversion is checkable.
 *
 * Paper, not the old lime. The lime belonged to the previous design, which now
 * survives only as the `workbench` skin — and an icon cannot have two skins. It
 * follows the default, which is the one a new install sees.
 */

/** `--kraft` · oklch(79% 0.045 68). The tile the mark is cut into. */
export const MARK_GROUND = '#ceb69c';

/** `--ink` · oklch(29% 0.022 62). The mark itself. */
export const MARK_INK = '#332920';

/**
 * The mark's geometry, on a 64-unit artboard.
 *
 * One definition, because the three rectangles are the logo: the stem, the
 * foot, and the detached bar that makes the L read as LI. Every icon draws
 * these same three, transformed differently for the shape it has to fit.
 *
 * Drawn as rectangles rather than an SVG path because Satori — the renderer
 * behind ImageResponse — has patchy support for inline SVG, and the mark
 * genuinely is three rectangles.
 */
export const MARK_PATH = 'M9 6h13v39h28v13H9z';
export const MARK_BAR = { x: 30, y: 6, width: 13, height: 26 } as const;
