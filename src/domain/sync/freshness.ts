import type { SyncRunStatus } from './outcome';

/**
 * Data freshness, as a first-class concept.
 *
 * The dangerous UI is not one that shows an error; it is one that shows
 * three-day-old coursework indistinguishably from coursework fetched a minute
 * ago. Freshness is therefore computed in the domain and returned alongside the
 * data, so a future frontend cannot render a list without also being handed the
 * answer to "how much should I trust this?".
 */

export type FreshnessLevel =
  /** Synchronised recently and completely. */
  | 'FRESH'
  /** Older than the comfort window but still within the usable window. */
  | 'AGEING'
  /** Old enough that the student should be told before acting on it. */
  | 'STALE'
  /** The last run did not complete for every course. */
  | 'PARTIAL'
  /** Never synchronised, or authorisation is broken. */
  | 'UNAVAILABLE';

export interface FreshnessInput {
  readonly lastSuccessfulSyncAt: Date | null;
  readonly lastAttemptedSyncAt: Date | null;
  readonly lastRunStatus: SyncRunStatus | null;
  readonly connectionUsable: boolean;
  readonly now: Date;
}

export interface FreshnessReport {
  readonly level: FreshnessLevel;
  readonly ageMs: number | null;
  readonly lastSuccessfulSyncAt: Date | null;
  readonly lastAttemptedSyncAt: Date | null;
  readonly lastRunStatus: SyncRunStatus | null;
  readonly reason: string;
}

export const FRESH_WINDOW_MS = 30 * 60 * 1000;
export const AGEING_WINDOW_MS = 6 * 60 * 60 * 1000;

export function assessFreshness(input: FreshnessInput): FreshnessReport {
  const base = {
    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
    lastAttemptedSyncAt: input.lastAttemptedSyncAt,
    lastRunStatus: input.lastRunStatus,
    };

  if (!input.connectionUsable) {
    return {
      ...base,
      level: 'UNAVAILABLE',
      ageMs: null,
      reason: 'Google Classroom authorisation is missing or revoked; reconnect required',
    };
  }

  if (input.lastSuccessfulSyncAt === null) {
    return {
      ...base,
      level: 'UNAVAILABLE',
      ageMs: null,
      reason: 'No successful synchronisation has completed yet',
    };
  }

  const ageMs = Math.max(0, input.now.getTime() - input.lastSuccessfulSyncAt.getTime());

  // A partial run is reported as PARTIAL even when it is recent: some courses
  // are simply not represented, and recency does not fix incompleteness.
  if (input.lastRunStatus === 'PARTIAL_SUCCESS') {
    return {
      ...base,
      level: 'PARTIAL',
      ageMs,
      reason: 'The most recent synchronisation failed for at least one course',
    };
  }

  if (ageMs <= FRESH_WINDOW_MS) {
    return { ...base, level: 'FRESH', ageMs, reason: 'Synchronised within the last 30 minutes' };
  }
  if (ageMs <= AGEING_WINDOW_MS) {
    return { ...base, level: 'AGEING', ageMs, reason: 'Synchronised within the last 6 hours' };
  }
  return {
    ...base,
    level: 'STALE',
    ageMs,
    reason: 'Last successful synchronisation is more than 6 hours old',
    };
}
