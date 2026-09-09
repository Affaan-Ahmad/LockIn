import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * What the student wrote about a piece of their own coursework.
 *
 * Writes to `assignment_notes`, which the sync pipeline can read but has no
 * write path to — the same separation `classification_overrides` has, and for
 * the same reason: "a sync will not overwrite what I wrote" should be a property
 * of the schema, not a promise in a comment.
 *
 * The ownership check lives in `app_set_assignment_note` rather than here. A
 * rule enforced in a route handler is a rule the next caller forgets.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const setSchema = z.object({
  assignmentId: z.string().uuid(),
  // Matches the CHECK constraint in 0015. Validated in both places on purpose:
  // this one produces a decent message, that one is the actual guarantee.
  body: z.string().trim().min(1).max(2000),
});

const clearSchema = z.object({ assignmentId: z.string().uuid() });

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = setSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new InvalidInputError(
        parsed.error.issues[0]?.message ?? 'A note needs an assignment and some text.',
      );
    }

    const context = await createBackendContext();
    const note = await context.notes.set(user.id, parsed.data.assignmentId, parsed.data.body);

    return jsonOk({
      assignmentId: note.assignmentId,
      body: note.body,
      updatedAt: note.updatedAt.toISOString(),
    });
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = clearSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new InvalidInputError('assignmentId is required');

    const context = await createBackendContext();
    await context.notes.clear(user.id, parsed.data.assignmentId);

    return jsonOk({ assignmentId: parsed.data.assignmentId, cleared: true });
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}
