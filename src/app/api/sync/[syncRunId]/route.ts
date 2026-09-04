import type { NextResponse } from 'next/server';

import { createBackendContext } from '@/infrastructure/composition';
import { isTerminalStatus } from '@/domain/sync/outcome';
import { NotFoundError } from '@/shared/errors';

import { clientSafeMessage, handleRoute, jsonOk, requireUser } from '../../_lib/handler';
import type { ErrorCode } from '@/shared/errors';

/**
 * The authoritative status of one run.
 *
 * This endpoint exists because the previous contract made the client guess.
 * Sync returned 200 with a body, and "did it work?" had to be inferred from
 * counts -- so a run that failed on every course was indistinguishable from one
 * that found nothing to do. Here the status is the answer, `complete` says
 * whether the question is even settled yet, and the counts are decoration.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ syncRunId: string }> },
): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { syncRunId } = await params;

    const context = await createBackendContext();
    const progress = await context.syncRuns.progress(syncRunId, user.id);

    // Scoped to the caller inside the repository, so a run belonging to someone
    // else is indistinguishable from one that does not exist. That is the
    // correct answer to give: anything else confirms the id is real.
    if (progress === null) throw new NotFoundError('Sync run not found');

    return jsonOk({
      syncRunId: progress.syncRunId,
      status: progress.status,
      // Spelled out rather than left to the client to derive from the status
      // string. A client that has not been updated for a new status should
      // treat the run as unfinished, not as a success.
      complete: isTerminalStatus(progress.status),
      mode: progress.mode,
      startedAt: progress.startedAt.toISOString(),
      finishedAt: progress.finishedAt?.toISOString() ?? null,
      counts: progress.counts,
      progress: {
        totalCourses: progress.totalCourses,
        completedCourses: progress.completedCourses,
        failedCourses: progress.failedCourses,
      },
      // Codes are stable and safe by design; the summary is an internal error
      // string and goes through the same whitelist a thrown error would.
      issueCodes: progress.issueCodes,
      errorSummary:
        progress.errorSummary === null
          ? null
          : clientSafeMessage(progress.errorSummary as ErrorCode, progress.errorSummary),
    });
  });
}
