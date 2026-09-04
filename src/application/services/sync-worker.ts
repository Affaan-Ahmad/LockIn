import type { SyncRunLease } from '@/application/ports/repositories';
import { toAppError } from '@/shared/errors';
import type { Logger } from '@/shared/logger';

import type {
  ClassroomSyncService,
  StartSyncInput,
  WorkOutcome,
} from './classroom-sync.service';

/**
 * Drives a synchronisation to completion across however many invocations it
 * takes.
 *
 * The worker itself only ever processes one bounded slice. This is the piece
 * that makes a slice into a chain: when a slice hands over, something has to
 * ask for the next one, or the run sits QUEUED until a human clicks again.
 *
 * WHY NOT THE BROWSER. Client-driven continuation is simpler and was rejected:
 * closing the tab would strand a run halfway through, and the student would be
 * looking at coursework that is silently half-refreshed. The browser is welcome
 * to *watch* -- that is what the progress endpoint is for -- but it must not be
 * load-bearing.
 *
 * WHY NOT A QUEUE. Vercel Queues and Workflows would both do this properly, and
 * both are billable products. On the free tier the equivalent is the server
 * asking itself for another invocation, which costs one HTTP request.
 *
 * THE CHAIN IS NOT THE GUARANTEE. A self-invocation can fail like anything
 * else. What makes the design safe is that failing to chain is indistinguishable
 * from crashing: the run is QUEUED with its completed work durable, and the next
 * trigger -- another sync, a page load, the daily sweep -- resumes it. The chain
 * is an optimisation on top of a system that is already correct without it.
 */

export interface ContinuationTrigger {
  /**
   * Asks for another invocation to continue this user's run.
   *
   * Fire-and-forget by contract: the caller must not await completion of the
   * successor, only the handoff. Returns whether the request was accepted, for
   * logging -- never for control flow.
   */
  request(userId: string, syncRunId: string): Promise<boolean>;
}

export interface SyncWorkerDeps {
  readonly sync: ClassroomSyncService;
  readonly continuation: ContinuationTrigger;
  readonly logger: Logger;
}

export class SyncWorker {
  constructor(private readonly deps: SyncWorkerDeps) {}

  /**
   * Runs one slice of an already-claimed run, then chains if work remains.
   *
   * Never throws. It is invoked from a background context where a rejection has
   * nowhere to go, and where an unhandled rejection would take down unrelated
   * requests sharing the instance.
   */
  async runSlice(lease: SyncRunLease, context: StartSyncInput): Promise<WorkOutcome> {
    const logger = this.deps.logger.child({
      syncRunId: lease.syncRunId,
      userId: lease.userId,
    });

    let outcome: WorkOutcome;
    try {
      outcome = await this.deps.sync.work(lease, context);
    } catch (caught) {
      // work() already converts run-level faults into a FAILED run. Reaching
      // here means something outside that contract broke, and the honest report
      // is that this slice failed -- not that the run did.
      const error = toAppError(caught);
      logger.error('sync slice threw outside the run contract', {
        stage: 'slice',
        errorCode: error.code,
      });
      return { kind: 'FAILED', syncRunId: lease.syncRunId, errorCode: error.code };
    }

    if (outcome.kind === 'HANDED_OFF') {
      const accepted = await this.deps.continuation
        .request(lease.userId, lease.syncRunId)
        .catch((cause: unknown) => {
          logger.warn('continuation request failed; run stays queued for recovery', {
            stage: 'continuation',
            errorCode: toAppError(cause).code,
          });
          return false;
        });

      logger.info('continuation requested', { stage: 'continuation', accepted });
    }

    return outcome;
  }

  /**
   * Picks up whatever is resumable for a user, if anything.
   *
   * Safe to call speculatively and concurrently: `resume` is a single
   * advisory-locked claim, so a duplicate caller gets null rather than a second
   * worker on the same run. That is what lets the continuation endpoint, a
   * manual retry and the recovery sweep all share one path.
   */
  async resumeAndRun(userId: string, context: StartSyncInput): Promise<WorkOutcome | null> {
    const lease = await this.deps.sync.resume(userId);
    if (lease === null) return null;

    return this.runSlice(lease, { ...context, userId, mode: lease.mode });
  }
}
