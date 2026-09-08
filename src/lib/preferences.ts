import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';

import { DEFAULT_TIME_FORMAT, isTimeFormat, TIME_FORMAT_COOKIE, type TimeFormat } from './clock';

/**
 * Display preferences the server has to know before it renders.
 *
 * Only the clock format so far. It lives here rather than beside the theme
 * because the theme is applied by a boot script in the browser, while times are
 * written into the HTML on the server -- so this one has to be readable before
 * a single row is drawn.
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
