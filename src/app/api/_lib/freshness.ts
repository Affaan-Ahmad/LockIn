import 'server-only';

import { assessFreshness, type FreshnessReport } from '@/domain/sync/freshness';
import type { BackendContext } from '@/infrastructure/composition';

/**
 * The freshness block every list endpoint returns.
 *
 * Extracted because it was previously computed only in the upcoming feed, which
 * meant the overdue, undated and course screens had no way to say how old their
 * data was -- and a screen that cannot say "this is two hours stale" implies it
 * is current. For an application whose failure mode is a missed deadline, that
 * is the wrong default, so freshness now travels with every list.
 *
 * Also carries the student's timezone. Without it the browser would render
 * deadlines in whatever zone the device happens to be in, which can disagree
 * with the zone the backend used to decide what counts as overdue -- so a
 * student travelling would see an item in the overdue tab labelled as due
 * tomorrow.
 */

export interface FreshnessPayload {
  readonly level: FreshnessReport['level'];
  readonly reason: string;
  readonly ageMs: number | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly lastAttemptedSyncAt: string | null;
  readonly lastRunStatus: string | null;
  /** IANA zone the backend used for date boundaries. The UI must render in it. */
  readonly timeZone: string;
}

export async function loadFreshness(
  context: BackendContext,
  userId: string,
  now = new Date(),
): Promise<FreshnessPayload> {
  // Concurrent, not sequential: these are three independent reads and chaining
  // them would add a round trip to every list request for no reason.
  const [lastSuccessfulSyncAt, latestRun, connection, profile] = await Promise.all([
    context.syncRuns.lastSuccessfulAt(userId),
    context.syncRuns.latestForUser(userId),
    context.connections.snapshot(userId),
    context.profiles.findByUserId(userId),
    ]);

  const report = assessFreshness({
    lastSuccessfulSyncAt,
    lastAttemptedSyncAt: latestRun?.startedAt ?? null,
    lastRunStatus: latestRun?.status ?? null,
    connectionUsable: connection !== null && connection.status === 'ACTIVE',
    now,
    });

  return {
    level: report.level,
    reason: report.reason,
    ageMs: report.ageMs,
    lastSuccessfulSyncAt: report.lastSuccessfulSyncAt?.toISOString() ?? null,
    lastAttemptedSyncAt: report.lastAttemptedSyncAt?.toISOString() ?? null,
    lastRunStatus: report.lastRunStatus,
    // UTC rather than the server's zone if the student has not set one. Falling
    // back to the server's zone would make deadline boundaries depend on where
    // the app happens to be deployed.
    timeZone: profile?.timeZone ?? 'UTC',
    };
}
