import { NextResponse } from 'next/server';
import { z } from 'zod';

import { deriveWorkerSecret, workerTokenMatches } from '@/config/sync-runtime';
import { getServerEnv } from '@/config/env';
import { createWorkerContext } from '@/infrastructure/composition';
import { createLogger } from '@/shared/logger';

import { runInBackground } from '../../_lib/handler';

/**
 * Continues a synchronisation that was handed over.
 *
 * The server calls this on itself when a worker reaches its internal deadline
 * with courses still queued. It is what turns a bounded slice into a run that
 * finishes without anyone's browser being open.
 *
 * It is deliberately NOT a guarantee. If this request never arrives -- the
 * handover failed, the instance died first, the network blinked -- the run is
 * already QUEUED with every completed course durable, and the next trigger
 * resumes it. A lost continuation costs latency, never work.
 *
 * SECURITY. There is no user session here, so the endpoint authenticates with a
 * secret derived from the service-role key. Beyond that it takes no instruction
 * from the caller about *what* to do: it resumes whatever the named user has
 * queued, or nothing. There is no parameter that widens its blast radius, and
 * an unauthenticated caller gets 401 before any work is looked up.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same ceiling as the initial slice; this is the same work, continued. */
export const maxDuration = 300;

const bodySchema = z.object({
  userId: z.string().uuid(),
  syncRunId: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const logger = createLogger({ base: { component: 'sync.continue' } });

  const env = getServerEnv();
  const expected = deriveWorkerSecret(env.SUPABASE_SERVICE_ROLE_KEY);
  const presented = request.headers.get('x-sync-worker-token');

  if (!workerTokenMatches(presented, expected)) {
    // No detail, no timing signal, no log of the presented value.
    logger.warn('rejected an unauthenticated continuation request');
    return NextResponse.json({ error: { code: 'AUTHENTICATION_ERROR' } }, { status: 401 });
  }

  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT' } }, { status: 400 });
  }

  const { userId } = parsed.data;
  const context = createWorkerContext();

  // Claimed synchronously so the response can say whether the work was actually
  // picked up. Doing this in the background would make every duplicate
  // continuation look accepted, and duplicates are normal here.
  const lease = await context.sync.resume(userId);

  if (lease === null) {
    // The ordinary answer when the run finished between handover and arrival,
    // or when another invocation got here first. Not an error.
    logger.info('nothing to resume', { userId });
    return NextResponse.json({ resumed: false }, { status: 200 });
  }

  const connection = await context.connections.snapshot(userId);

  runInBackground(
    context.worker.runSlice(lease, {
      userId,
      trigger: 'ON_DEMAND',
      mode: lease.mode,
      googleUserId: connection?.googleUserId ?? null,
      onSourceUserIdObserved: async (sourceUserId: string) => {
        await context.connections.setGoogleUserId(userId, sourceUserId);
      },
    }),
    'sync.continue',
  );

  return NextResponse.json(
    { resumed: true, syncRunId: lease.syncRunId, resumeAttempt: lease.resumeAttempts },
    { status: 202 },
  );
}
