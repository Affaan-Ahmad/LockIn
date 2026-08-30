import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * The student's own decision about an assignment.
 *
 * Writes to classification_overrides, which the sync pipeline can read but has
 * no write path to. That separation is what makes "a sync will not erase what I
 * decided" a property of the system rather than a promise.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const setSchema = z.object({
  assignmentId: z.string().uuid(),
  // Only decisive values. "I am unsure" is the absence of an override, which is
  // also what the database CHECK constraint enforces.
  relevance: z.enum(['RELEVANT', 'NOT_RELEVANT']),
  note: z.string().max(500).nullable().default(null),
});

const clearSchema = z.object({ assignmentId: z.string().uuid() });

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = setSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Invalid override payload');
    }

    const context = await createBackendContext();
    const override = await context.overrides.set(
      user.id,
      parsed.data.assignmentId,
      parsed.data.relevance,
      parsed.data.note,
    );

    return jsonOk({
      assignmentId: parsed.data.assignmentId,
      relevance: override.relevance,
      note: override.note,
      decidedAt: override.decidedAt.toISOString(),
    });
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = clearSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new InvalidInputError('assignmentId is required');
    }

    const context = await createBackendContext();
    await context.overrides.clear(user.id, parsed.data.assignmentId);

    // Removing the override changes the classification input fingerprint, so
    // the next sync re-evaluates the assignment automatically.
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
