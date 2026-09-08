import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { SKIN_COOKIE } from '@/lib/skin';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Which of the two front ends to render.
 *
 * A cookie for the same reason the clock format is one: the choice decides which
 * page frame the server builds, so it has to be readable before the first byte
 * of HTML. Storing it in the browser would mean shipping one whole design and
 * then swapping it for the other.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A year. Long enough not to nag, short enough to lapse on a shared device. */
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const bodySchema = z.object({ skin: z.enum(['paper', 'workbench']) });

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
      throw new InvalidInputError('A skin of "paper" or "workbench" is required.');
    }

    const response = jsonOk({ skin: parsed.data.skin });
    response.cookies.set(SKIN_COOKIE, parsed.data.skin, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  });
}
