import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { loadFreshness } from '../../_lib/freshness';
import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Tracked coursework that Google gave no due date for.
 *
 * A separate endpoint backed by a separate query, not a flag on the upcoming
 * feed. The application is a deadline tracker: work with no deadline is real
 * and worth keeping, but it cannot be ordered by when it is due and must not
 * appear in a list the student reads as "what is due next".
 *
 * The alternative -- inventing 23:59, or today's date, to give it a slot -- is
 * precisely the fabrication this backend refuses to do.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  relevance: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? ['RELEVANT', 'UNCERTAIN'] : value.split(','),
    )
    .pipe(z.array(z.enum(['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'])).min(1)),
    limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();

    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Invalid query parameters');
    }

    const context = await createBackendContext();
    const [items, freshness] = await Promise.all([
      context.assignments.findUndated({
        userId: user.id,
        relevance: parsed.data.relevance,
        limit: parsed.data.limit,
      }),
      loadFreshness(context, user.id),
    ]);

    return jsonOk({
      freshness,
      items: items.map((item) => ({
        assignmentId: item.assignmentId,
        courseId: item.courseId,
        courseName: item.courseName,
        title: item.title,
        relevance: item.relevance,
        hasManualOverride: item.hasManualOverride,
        scopeType: item.scopeType,
        submissionState: item.submissionState,
        postedAt: item.sourceCreatedAt?.toISOString() ?? null,
        link: item.alternateLink,
      })),
    });
  });
}
