/**
 * Bounded-concurrency map.
 *
 * `Promise.all(courses.map(fetch))` looks harmless with six courses and issues
 * two hundred simultaneous requests for a student with a heavy enrolment
 * history, which is how a project earns a 429 storm. This keeps at most `limit`
 * tasks in flight and preserves input order in the output.
 *
 * It never rejects: each task's outcome is returned as a settled entry so one
 * failing course cannot discard the results of the others.
 */

export type Settled<T> =
  | { readonly status: 'fulfilled'; readonly value: T; readonly index: number }
  | { readonly status: 'rejected'; readonly reason: unknown; readonly index: number };

export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  task: (item: TIn, index: number) => Promise<TOut>,
): Promise<Settled<TOut>[]> {
  if (limit < 1) throw new RangeError(`concurrency limit must be >= 1, received ${limit}`);
  const results = new Array<Settled<TOut>>(items.length);
  if (items.length === 0) return results;

  let cursor = 0;
  const workerCount = Math.min(limit, items.length);

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index] as TIn;
      try {
        results[index] = { status: 'fulfilled', value: await task(item, index), index };
      } catch (reason) {
        results[index] = { status: 'rejected', reason, index };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Splits into fixed-size chunks for batch inserts. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError(`chunk size must be >= 1, received ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
