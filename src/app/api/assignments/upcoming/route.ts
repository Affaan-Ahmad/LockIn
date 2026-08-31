import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { loadFreshness } from '../../_lib/freshness';
import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Reads upcoming coursework.
 *
 * Every response carries a freshness block. That is not decoration: without it
 * a future frontend cannot tell three-day-old data from data fetched a minute
 * ago, and academic deadlines are precisely the case where that difference
 * matters. The API refuses to hand back a list without also handing back how
 * much it should be trusted.
 *
 * The default relevance filter is RELEVANT plus UNCERTAIN. Ambiguous coursework
 * stays visible by default; hiding it would defeat the point of having a third
 * value at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).default(30),
  relevance: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? ['RELEVANT', 'UNCERTAIN'] : value.split(','),
    )
    .pipe(z.array(z.enum(['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'])).min(1)),
    includeSubmitted: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
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
    const now = new Date();
    const to = new Date(now.getTime() + parsed.data.withinDays * 24 * 60 * 60 * 1000);

    const [items, freshness] = await Promise.all([
      context.assignments.findUpcoming({
        userId: user.id,
        to,
        relevance: parsed.data.relevance,
        includeSubmitted: parsed.data.includeSubmitted,
        limit: parsed.data.limit,
      }),
      loadFreshness(context, user.id, now),
    ]);

    return jsonOk({
      freshness,
      items: items.map((item) => ({
        assignmentId: item.assignmentId,
        courseId: item.courseId,
        courseName: item.courseName,
        title: item.title,
        // Precision travels with the deadline so a consumer physically cannot
        // render a time for an item that never had one.
        deadline: {
          precision: item.deadline.precision,
          dueAtUtc: item.deadline.dueAt?.toISOString() ?? null,
          dueDateUtc: formatCalendarDate(item.deadline.dueDate),
        },
        relevance: item.relevance,
        confidence: item.confidence,
        hasManualOverride: item.hasManualOverride,
        // The assignment's own scope travels beside the per-student verdict so
        // a client can explain "why am I seeing this?" without a second call.
        scope: { type: item.scopeType, sections: item.scopeSections },
        submissionState: item.submissionState,
        lastSyncedAt: item.lastSyncedAt.toISOString(),
        link: item.alternateLink,
      })),
    });
  });
}

function formatCalendarDate(
  date: { year: number; month: number; day: number } | null,
): string | null {
  if (date === null) return null;
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}
