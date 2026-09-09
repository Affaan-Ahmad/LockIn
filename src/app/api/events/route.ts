import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { USER_EVENT_KINDS } from '@/domain/student-content/types';
import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * Dates the student adds themselves.
 *
 * The quiz announced in a lecture and never posted to Classroom is the whole
 * reason this exists. It is real and it is dated, and no amount of syncing will
 * ever discover it — so it has to be possible to say so.
 *
 * Nothing here touches Google, and nothing here is derived from anything. That
 * makes these rows the only ones in the system a sync cannot rebuild, which is
 * why deletion is the one operation that asks for an explicit id rather than
 * being inferred.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(USER_EVENT_KINDS as unknown as [string, ...string[]]).default('OTHER'),
  // An instant, not a wall-clock string. The browser converts from the field the
  // student typed into using their own zone, so a 9am quiz stays 9am for them
  // rather than drifting to whatever the server thinks 9am is.
  startsAt: z.coerce.date(),
  note: z.string().trim().max(500).nullable().default(null),
});

const deleteSchema = z.object({ eventId: z.string().uuid() });

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new InvalidInputError(
        parsed.error.issues[0]?.message ?? 'An event needs a title and a date.',
      );
    }

    const context = await createBackendContext();
    const event = await context.events.create(user.id, {
      title: parsed.data.title,
      kind: parsed.data.kind as (typeof USER_EVENT_KINDS)[number],
      startsAt: parsed.data.startsAt,
      note: parsed.data.note,
    });

    return jsonOk(
      {
        id: event.id,
        title: event.title,
        kind: event.kind,
        startsAt: event.startsAt.toISOString(),
        note: event.note,
      },
      201,
    );
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = deleteSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new InvalidInputError('eventId is required');

    const context = await createBackendContext();
    await context.events.delete(user.id, parsed.data.eventId);

    // Deliberately the same answer whether a row was removed or there was
    // nothing to remove. The delete is scoped to the caller, so "not yours" and
    // "not there" are the same fact, and distinguishing them would say whether
    // somebody else's event id is real.
    return jsonOk({ eventId: parsed.data.eventId, deleted: true });
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}
