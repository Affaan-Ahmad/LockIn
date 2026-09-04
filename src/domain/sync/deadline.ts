import type { Clock } from '@/shared/clock';

/**
 * The worker's own execution budget.
 *
 * The platform timeout is an emergency boundary, not control flow. Being killed
 * by it is the worst available outcome: the invocation stops between two
 * statements, nothing is finalised, the lease is still held, and the run is
 * only recoverable once that lease expires. Every one of those costs is avoided
 * by stopping voluntarily a little early and handing the work over cleanly.
 *
 * So the worker tracks its own deadline and answers one question before each
 * unit: is there enough time left to finish this unit *and* check out cleanly?
 * If not, it stops scheduling, releases the lease, and asks for a continuation.
 *
 * The reserve is not a guess at how long a course takes -- it is how long the
 * shutdown path needs: complete the unit in flight, write its result, release
 * the lease, and start the successor. Those are three small round trips.
 */

export interface DeadlineOptions {
  /** Total wall-clock this invocation may use, from `start`. */
  readonly budgetMs: number;
  /**
   * Held back for checkout. A unit is only started when the remaining time
   * exceeds this plus the unit's own estimate.
   */
  readonly reserveMs: number;
  /**
   * Rolling estimate of how long one unit takes. Seeded, then replaced by
   * observation -- a student with enormous courses and one with tiny courses
   * should not share a hardcoded guess.
   */
  readonly initialUnitEstimateMs: number;
}

export interface DeadlineDecision {
  readonly canStartAnotherUnit: boolean;
  readonly remainingMs: number;
  readonly reason: 'OK' | 'BUDGET_EXHAUSTED' | 'UNIT_WOULD_OVERRUN';
}

export class ExecutionDeadline {
  private readonly startedAt: number;
  private readonly budgetMs: number;
  private readonly reserveMs: number;
  private unitEstimateMs: number;
  private unitsCompleted = 0;

  constructor(
    private readonly clock: Clock,
    options: DeadlineOptions,
  ) {
    this.startedAt = clock.now().getTime();
    this.budgetMs = options.budgetMs;
    this.reserveMs = options.reserveMs;
    this.unitEstimateMs = options.initialUnitEstimateMs;
  }

  elapsedMs(): number {
    return this.clock.now().getTime() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.budgetMs - this.elapsedMs());
  }

  /**
   * Whether to begin another unit of work.
   *
   * Deliberately asked *before* starting, never checked mid-unit. A unit that
   * has begun always runs to completion and persists its result: abandoning it
   * halfway is what produces the torn state this design exists to avoid.
   */
  shouldStartUnit(): DeadlineDecision {
    const remainingMs = this.remainingMs();

    if (remainingMs <= this.reserveMs) {
      return { canStartAnotherUnit: false, remainingMs, reason: 'BUDGET_EXHAUSTED' };
    }
    if (remainingMs - this.reserveMs < this.unitEstimateMs) {
      return { canStartAnotherUnit: false, remainingMs, reason: 'UNIT_WOULD_OVERRUN' };
    }
    return { canStartAnotherUnit: true, remainingMs, reason: 'OK' };
  }

  /**
   * Feeds an observed unit duration back into the estimate.
   *
   * A running maximum rather than an average, and deliberately so. The estimate
   * exists to decide whether the *next* unit fits, and being wrong in the
   * optimistic direction means being killed by the platform. Averaging lets one
   * fast course license starting a slow one; taking the worst seen keeps the
   * decision conservative, which is the direction that is cheap to be wrong in.
   */
  recordUnit(durationMs: number): void {
    this.unitsCompleted += 1;
    this.unitEstimateMs = Math.max(this.unitEstimateMs, durationMs);
  }

  get completedUnits(): number {
    return this.unitsCompleted;
  }

  get currentUnitEstimateMs(): number {
    return this.unitEstimateMs;
  }
}

/**
 * Derives a worker budget from the platform's own limit.
 *
 * Expressed as a fraction rather than a fixed subtraction so it stays correct
 * whether the platform gives 60 seconds or 300. The margin covers the cost of
 * everything outside the loop: cold start, credential acquisition, discovery,
 * and the final write.
 */
export function deriveBudget(platformMaxDurationMs: number): {
  budgetMs: number;
  reserveMs: number;
} {
  // 80% of the platform limit, and never within 10s of it.
  const budgetMs = Math.max(
    5_000,
    Math.min(platformMaxDurationMs * 0.8, platformMaxDurationMs - 10_000),
  );
  // Enough for: finish current unit's writes, release lease, trigger successor.
  const reserveMs = Math.max(3_000, Math.min(8_000, budgetMs * 0.15));
  return { budgetMs, reserveMs };
}
