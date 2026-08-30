/**
 * Injected everywhere a timestamp is written or compared. Deadline logic,
 * lease expiry and staleness windows are all time-dependent; a test that
 * cannot control "now" cannot assert on any of them.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`fixedClock received an invalid instant: ${iso}`);
  }
  return { now: () => new Date(instant.getTime()) };
}
