import { NextResponse } from 'next/server';

import { getServerEnv } from '@/config/env';
import { workerTokenMatches } from '@/config/sync-runtime';
import { createWorkerContext } from '@/infrastructure/composition';
import { createLogger } from '@/shared/logger';

import { runInBackground } from '../../_lib/handler';

/**
 * Recovery sweep: picks up runs nobody came back for.
 *
 * The last line of defence, and deliberately the least important one. A run is
 * normally continued by the server calling itself, and failing that by the
 * student's next sync. This exists for the case where neither happened -- the
 * handover failed *and* nobody returned -- so that a stranded run is eventually
 * finished rather than sitting QUEUED forever.
 *
 * On Vercel's free tier cron runs at most once a day with up to an hour of
 * scheduling jitter, which is exactly the right shape for a floor: too coarse
 * to be a mechanism, entirely adequate as a backstop. It costs nothing.
 *
 * Bounded on purpose. One invocation resumes a handful of users and stops; the
 * next day's sweep takes the rest. A sweep that tried to drain everything would
 * be the one unbounded loop in a design built to remove them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Resumed per sweep. Each one costs a full slice of Google calls. */
const MAX_USERS_PER_SWEEP = 5;

export async function GET(request: Request): Promise<NextResponse> {
  const logger = createLogger({ base: { component: 'sync.sweep' } });
  const env = getServerEnv();

  // Refuses rather than standing open. An unauthenticated endpoint that resumes
  // other people's synchronisations is worse than having no sweep.
  if (env.CRON_SECRET === undefined) {
    logger.warn('sweep is not configured; set CRON_SECRET to enable it');
    return NextResponse.json({ error: { code: 'NOT_CONFIGURED' } }, { status: 503 });
  }

  const presented = request.headers.get('authorization');
  const expected = `Bearer ${env.CRON_SECRET}`;
  if (!workerTokenMatches(presented, expected)) {
    logger.warn('rejected an unauthenticated sweep request');
    return NextResponse.json({ error: { code: 'AUTHENTICATION_ERROR' } }, { status: 401 });
  }

  const context = createWorkerContext();
  const userIds = await context.syncRuns.findResumableUserIds(MAX_USERS_PER_SWEEP);

  logger.info('sweep found stranded runs', { stage: 'sweep', candidates: userIds.length });

  for (const userId of userIds) {
    // Sequential, not parallel. These are full synchronisation slices; running
    // five at once would multiply the Google request rate by five for no gain,
    // since the sweep has a whole day before it needs to matter.
    runInBackground(
      context.worker.resumeAndRun(userId, {
        userId,
        trigger: 'SCHEDULED',
        mode: 'INCREMENTAL',
      }),
      'sync.sweep',
    );
  }

  return NextResponse.json({ swept: userIds.length }, { status: 200 });
}
