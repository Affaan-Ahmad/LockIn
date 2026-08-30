import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * Course discovery and subject selection.
 *
 * `GET` answers "what could I track?" and deliberately returns untracked
 * courses too -- that is the whole point of the screen it feeds. `?refresh=true`
 * re-reads the list from Google; without it the endpoint is a cheap database
 * read, so opening the settings screen does not cost an API call.
 *
 * `PUT` is the only path in the application that changes a tracking decision.
 * The sync pipeline has no equivalent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const trackingSchema = z.object({
  courses: z
    .array(
      z.object({
        courseId: z.string().uuid(),
        isTracked: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const context = await createBackendContext();

    const refresh = new URL(request.url).searchParams.get('refresh') === 'true';

    const courses = refresh
      ? (await context.discovery.discover(user.id, 'discovery-only')).courses
      : await context.discovery.list(user.id);

    return jsonOk({
      refreshed: refresh,
      courses: courses.map((course) => ({
        courseId: course.courseId,
        googleCourseId: course.sourceCourseId,
        name: course.name,
        section: course.section,
        courseState: course.courseState,
        isTracked: course.decision === 'TRACKED',
        // Null distinguishes "never chosen" from "chosen and declined", which
        // is what lets a client prompt only about genuinely new courses.
        decidedAt: course.decidedAt?.toISOString() ?? null,
        lastSyncedAt: course.lastSyncedAt.toISOString(),
      })),
    });
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();

    let body: unknown;
    try {
      body = (await request.json()) as unknown;
    } catch {
      body = null;
    }

    const parsed = trackingSchema.safeParse(body);
    if (!parsed.success) {
      throw new InvalidInputError(
        parsed.error.issues[0]?.message ?? 'Expected { courses: [{ courseId, isTracked }] }',
      );
    }

    const context = await createBackendContext();
    const updated = await context.discovery.setTracking(
      user.id,
      parsed.data.courses.map((entry) => ({
        courseId: entry.courseId,
        decision: entry.isTracked ? ('TRACKED' as const) : ('NOT_TRACKED' as const),
      })),
    );

    return jsonOk({ updated });
  });
}
