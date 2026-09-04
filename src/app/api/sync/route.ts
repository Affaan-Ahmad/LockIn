import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { enforceRateLimit, handleRoute, jsonOk, requireUser, runInBackground } from '../_lib/handler';

/**
 * Starts a synchronisation run.
 *
 * Answers as soon as the run exists, not when it finishes. That inversion is
 * the point of the whole redesign: the previous handler awaited the entire
 * multi-course sync, so the platform's request timeout was the sync's timeout,
 * and losing the connection lost the work.
 *
 * Now the request does three cheap things -- authenticate, rate limit, claim a
 * run -- and hands back an id. The synchronisation itself proceeds in the
 * background and survives this response, this connection, and if necessary this
 * invocation.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The platform ceiling, taken in full.
 *
 * Verified rather than assumed: with fluid compute -- default for projects
 * created after April 2025 -- Hobby allows 300s as both the default and the
 * maximum, so the previous `maxDuration = 60` was cutting the available budget
 * by five. This is not the sync's time limit; the worker's own deadline is,
 * and it sits at 80% of this. This is the emergency boundary.
 *
 * MUST equal PLATFORM_MAX_DURATION_SECONDS in `src/config/sync-runtime.ts`.
 * Next.js requires a statically analysable literal here so it cannot import the
 * constant; a unit test asserts the two have not drifted.
 */
export const maxDuration = 300;

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

    // The lease stops two syncs overlapping. This stops a hundred running back
    // to back, which is what would actually burn the Google quota.
    await enforceRateLimit(
      context.rateLimiter,
      user.id,
      'sync',
      context.limits.sync.limit,
      context.limits.sync.windowSeconds,
    );

    const connection = await context.connections.snapshot(user.id);

    // Adopts a run left queued by a worker that died, or starts a fresh one.
    // Only a genuinely live run is refused with SYNC_ALREADY_RUNNING.
    const { lease, resumed } = await context.sync.startOrResume({
      userId: user.id,
      trigger: 'MANUAL',
      mode: parsed.data.mode,
    });

    const workContext = {
      userId: user.id,
      trigger: 'MANUAL' as const,
      mode: lease.mode,
      googleUserId: connection?.googleUserId ?? null,
      onSourceUserIdObserved: async (sourceUserId: string) => {
        await context.connections.setGoogleUserId(user.id, sourceUserId);
      },
    };

    // Continues after this response is sent. If the platform declines to keep
    // the invocation alive, nothing is lost: the run is claimed and durable,
    // and the first thing the worker does on any later trigger is resume it.
    runInBackground(context.worker.runSlice(lease, workContext), 'sync.start');

    // 202: accepted, not completed. The status of the work is a separate
    // question with a separate endpoint, and conflating the two is what let a
    // failed run be read as a successful one.
    return jsonOk(
      {
        syncRunId: lease.syncRunId,
        status: 'RUNNING' as const,
        mode: lease.mode,
        startedAt: lease.startedAt.toISOString(),
        pollUrl: `/api/sync/${lease.syncRunId}`,
        // True when this picked up work a previous invocation left behind. The
        // client shows the same progress either way; this is for the logs.
        resumed,
      },
      202,
    );
  });
}
