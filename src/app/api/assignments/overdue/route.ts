import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { loadFreshness } from '../../_lib/freshness';
import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Coursework whose deadline has passed and that is not submitted.
 *
 * Its own tab rather than merged into the upcoming feed. They answer different
 * questions -- "what is coming" versus "what did I miss" -- and merging them
 * would bury a deadline three days away under work from six weeks ago.
 *
 * It exists at all because the upcoming feed used to start at "now", so
 * anything already past due silently vanished. For a deadline tracker that is
 * backwards: unsubmitted overdue work is the most urgent thing a student has.
 *
 * Sorted most-recently-missed first, which is how triage actually works.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  // Optional floor, so returning after a long break does not bury the student
  // under a year of missed work. 0 means no floor at all.
  withinDays: z.coerce.number().int().min(0).max(365).default(60),
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
    const since =
      parsed.data.withinDays === 0
        ? null
        : new Date(now.getTime() - parsed.data.withinDays * 24 * 60 * 60 * 1000);

    const [items, freshness] = await Promise.all([
      context.assignments.findOverdue({
        userId: user.id,
        since,
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
        deadline: {
          precision: item.deadline.precision,
          dueAtUtc: item.deadline.dueAt?.toISOString() ?? null,
          dueDateUtc: formatCalendarDate(item.deadline.dueDate),
        },
        // How late, in whole days. Computed here rather than in a client so
        // every consumer agrees, and only for EXACT deadlines -- a date-only
        // item has no instant to measure from without inventing one.
        overdueByDays:
          item.deadline.dueAt === null
            ? null
            : Math.floor((now.getTime() - item.deadline.dueAt.getTime()) / 86_400_000),
        relevance: item.relevance,
        confidence: item.confidence,
        hasManualOverride: item.hasManualOverride,
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
