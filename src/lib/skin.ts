/**
 * Which front end the student is looking at.
 *
 * Not a colour scheme. `paper` and `workbench` are two complete designs that
 * happen to render the same data: different page frames, different navigation,
 * different composition of the Today screen, different materials. Light and dark
 * are a property *of* each skin, so the two settings are orthogonal -- there are
 * four combinations and all of them are real.
 *
 * A cookie rather than local storage, for the same reason the clock format is:
 * the frame is chosen on the server. A preference the browser held alone would
 * mean rendering one entire front end and then replacing it, which is not a
 * flicker but a different page arriving late.
 */

export type Skin = 'paper' | 'workbench';

export const SKIN_COOKIE = 'lockin_skin';

/** Paper. The workbench is the previous design, kept rather than deleted. */
export const DEFAULT_SKIN: Skin = 'paper';

export function isSkin(value: unknown): value is Skin {
  return value === 'paper' || value === 'workbench';
}

export const SKIN_LABEL: Readonly<Record<Skin, string>> = {
  paper: 'Paper',
  workbench: 'Workbench',
};

export const SKIN_DESCRIPTION: Readonly<Record<Skin, string>> = {
  paper: 'Cut sheets, hard edges, warm neutrals.',
  workbench: 'The earlier design: soft cards on a plain ground.',
};
