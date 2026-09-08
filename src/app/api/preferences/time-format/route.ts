import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { TIME_FORMAT_COOKIE } from '@/lib/clock';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Whether times are written on a twelve- or twenty-four-hour clock.
 *
 * A cookie rather than local storage, because the timetable is rendered on the
 * server: a preference the server cannot read would mean drawing every time in
 * the wrong format and then correcting it in the browser, which is a visible
 * flicker on the one part of the screen a student is reading for a number.
 *
 * The theme control next to it can afford local storage precisely because it
 * has a boot script to apply it before first paint. That script is pinned in
 * the Content-Security-Policy by hash, and adding to it would mean changing
 * that hash -- a far larger commitment than this preference is worth.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A year. Long enough not to nag, short enough to lapse on a shared device. */
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const bodySchema = z.object({ timeFormat: z.enum(['12', '24']) });

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    await requireUser();

    let body: unknown;
    try {
      body = (await request.json()) as unknown;
    } catch {
      body = null;
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new InvalidInputError('A time format of "12" or "24" is required.');
    }

    const response = jsonOk({ timeFormat: parsed.data.timeFormat });
    response.cookies.set(TIME_FORMAT_COOKIE, parsed.data.timeFormat, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  });
}
