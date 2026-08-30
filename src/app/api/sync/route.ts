import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * Triggers a synchronisation run.
 *
 * The handler validates input, resolves the caller, and calls one service
 * method. Concurrency, partial failure and error mapping are all handled below
 * this layer -- a second simultaneous request is rejected by the database lease,
 * not by anything written here.
 */

export const runtime = 'nodejs';
// Sync reads the user's session and writes their data; a cached response would
// be both wrong and a cross-user hazard.
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  mode: z.enum(['FULL', 'INCREMENTAL']).default('INCREMENTAL'),
});

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();

    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidInputError('mode must be FULL or INCREMENTAL');
    }

    const context = await createBackendContext();
    const connection = await context.connections.snapshot(user.id);

    const outcome = await context.sync.run({
      userId: user.id,
      trigger: 'MANUAL',
      mode: parsed.data.mode,
      googleUserId: connection?.googleUserId ?? null,
      onSourceUserIdObserved: async (sourceUserId) => {
        await context.connections.setGoogleUserId(user.id, sourceUserId);
      },
    });

    // 200 even for PARTIAL_SUCCESS and FAILED: the run completed and produced a
    // structured result the caller needs to read. A bare 500 would discard the
    // per-course breakdown that makes the outcome actionable.
    return jsonOk({
      syncRunId: outcome.syncRunId,
      status: outcome.status,
      mode: outcome.mode,
      startedAt: outcome.startedAt.toISOString(),
      finishedAt: outcome.finishedAt.toISOString(),
      counts: outcome.counts,
      courses: outcome.courses.map((course) => ({
        sourceCourseId: course.sourceCourseId,
        courseName: course.courseName,
        status: course.status,
        completeness: course.completeness,
        counts: course.counts,
        issueCount: course.issues.length,
      })),
      issues: outcome.issues.map((issue) => ({
        code: issue.code,
        scope: issue.scope,
        message: issue.message,
        retryable: issue.retryable,
      })),
    });
  });
}
