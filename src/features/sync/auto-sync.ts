import type { FreshnessLevel } from '@/domain/sync/freshness';

/**
 * When opening the app should refresh it by itself.
 *
 * Pure, so the rule is testable without a browser and readable without tracing
 * a component. The rule is small and every clause is load-bearing:
 *
 *   FRESH does nothing. The data is under half an hour old; spending a Google
 *   quota to replace it with the same data is waste.
 *
 *   AGEING, STALE and PARTIAL all refresh. This is the whole point -- a student
 *   who opens the app should not have to notice the data is old and press a
 *   button to fix it. PARTIAL is included because some course failed last time
 *   and retrying it is exactly the right move.
 *
 *   UNAVAILABLE does nothing, and this is the clause worth pausing on. It means
 *   the Google authorisation is missing or revoked, and no amount of syncing
 *   fixes that -- every attempt would fail identically, burn a rate-limit slot,
 *   and leave the student staring at a spinner that resolves to the same
 *   message. The reconnect prompt is the answer there, not a retry.
 */
export function shouldAutoSync(level: FreshnessLevel): boolean {
  return level === 'AGEING' || level === 'STALE' || level === 'PARTIAL';
}

/**
 * How long to wait before a visit may trigger another automatic sync.
 *
 * Not the same question as "is the data stale". A student moving between
 * Today, Upcoming and Review in one sitting mounts this component repeatedly,
 * and without a cooldown each mount would fire a sync: the server-rendered
 * freshness is a snapshot from before the first one finished, so every page
 * still looks stale. Ten of those exhausts the rate limit and the student ends
 * up with fewer syncs than if we had done nothing.
 *
 * Five minutes is comfortably longer than a sync takes and comfortably shorter
 * than the thirty-minute FRESH window, so a genuine visit after a real gap
 * still refreshes.
 */
export const AUTO_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Whether enough time has passed since the last automatic attempt.
 *
 * `lastAttemptAt` comes from browser storage, so it is whatever was there:
 * absent on a first visit, a stale value from another day, or garbage a user
 * typed into devtools. Anything unparseable is treated as "no attempt on
 * record", which fails towards syncing -- the direction where the cost is one
 * redundant request rather than silently never refreshing again.
 */
export function cooldownElapsed(lastAttemptAt: string | null, now: number): boolean {
  if (lastAttemptAt === null) return true;

  const parsed = Number(lastAttemptAt);
  if (!Number.isFinite(parsed)) return true;

  // A timestamp in the future means a clock change or a tampered value. Treat
  // it as expired rather than locking automatic sync out until it catches up.
  if (parsed > now) return true;

  return now - parsed >= AUTO_SYNC_COOLDOWN_MS;
}
