import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';

import { DEFAULT_TIME_FORMAT, isTimeFormat, TIME_FORMAT_COOKIE, type TimeFormat } from './clock';
import { DEFAULT_SKIN, isSkin, SKIN_COOKIE, type Skin } from './skin';

/**
 * Display preferences the server has to know before it renders.
 *
 * Two of them: how times are written, and which of the two front ends to build.
 * Both live here rather than beside the light/dark theme, because that one is
 * applied by a boot script in the browser while these are baked into the HTML on
 * the server -- they have to be readable before a single row is drawn.
 */

/**
 * The stored choice, or the product's default when nothing has been chosen.
 *
 * Cached for the request. Every assignment row asks for this, and a list of
 * forty would otherwise read the same cookie forty times to reach the same
 * answer.
 */
export const readTimeFormat = cache(async (): Promise<TimeFormat> => {
  const stored = (await cookies()).get(TIME_FORMAT_COOKIE)?.value;
  return isTimeFormat(stored) ? stored : DEFAULT_TIME_FORMAT;
});


/**
 * Which front end to build, or the default when nothing has been chosen.
 *
 * Cached for the request like the clock format, and for a stronger reason: the
 * layout, the shell and the Today screen each ask for it, and they must all get
 * the same answer or the page would be assembled from two different designs.
 */
export const readSkin = cache(async (): Promise<Skin> => {
  const stored = (await cookies()).get(SKIN_COOKIE)?.value;
  return isSkin(stored) ? stored : DEFAULT_SKIN;
});
