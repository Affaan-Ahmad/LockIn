import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * Hide or restore one assignment.
 *
 * Deliberately not the same endpoint as /api/overrides. An override answers
 * "is this mine?"; ignoring answers "do I still need to see it?". Sharing a
 * route would invite sharing a column, and then a missed lab that genuinely was
 * for the student's section would be recorded as evidence that it was not.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  assignmentId: z.string().uuid(),
  note: z.string().trim().max(200).nullable().default(null),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new InvalidInputError('assignmentId is required');

    const context = await createBackendContext();
    await context.assignments.setIgnored(
      user.id,
      parsed.data.assignmentId,
      true,
      parsed.data.note,
    );

    return jsonOk({ assignmentId: parsed.data.assignmentId, ignored: true });
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new InvalidInputError('assignmentId is required');

    const context = await createBackendContext();
    await context.assignments.setIgnored(user.id, parsed.data.assignmentId, false, null);

    return jsonOk({ assignmentId: parsed.data.assignmentId, ignored: false });
  });
}
