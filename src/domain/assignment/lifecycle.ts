/**
 * Local lifecycle for synchronised records.
 *
 * Kept separate from `sourceState` (Google's own PUBLISHED/DRAFT/DELETED)
 * because they answer different questions: sourceState is what Google says
 * about the item, lifecycleStatus is what *we* know about our copy of it.
 *
 * The reason this exists at all is that an item vanishing from an API response
 * is weak evidence. Pagination truncation, a partial outage, a permission
 * change, a network failure mid-listing -- all of them look identical to
 * deletion if you only compare one response against the database. Deleting on
 * that evidence destroys a student's record of real coursework.
 */

export type LifecycleStatus =
  /** Present in the most recent complete listing. */
  | 'ACTIVE'
  /** Absent from at least one complete listing, but not yet enough to conclude. */
  | 'SOURCE_MISSING'
  /** Absent from enough consecutive complete listings to conclude it is gone. */
  | 'SOURCE_REMOVED'
  /** Retained deliberately (old term, closed course) and excluded from the hot path. */
  | 'ARCHIVED';

/** Google's own state for the coursework, preserved verbatim. */
export type SourceState = 'PUBLISHED' | 'DRAFT' | 'DELETED' | 'UNSPECIFIED';

/**
 * How many consecutive *complete* listings must miss an item before we conclude
 * it was removed. Two, not one: a single bad response is the common case, two
 * in a row is not. Nothing is ever hard-deleted regardless.
 */
export const MISSING_STREAK_THRESHOLD = 2;

/**
 * Completeness of a course listing.
 *
 * Only COMPLETE listings may drive disappearance reconciliation. An incremental
 * sync stops paging as soon as it crosses the watermark and therefore only ever
 * sees a prefix -- treating that prefix as the full set would mark almost every
 * item missing on the first incremental run.
 */
export type ListingCompleteness = 'COMPLETE' | 'PARTIAL' | 'FAILED';

export interface MissingTransition {
  readonly status: LifecycleStatus;
  readonly missingStreak: number;
}

export function onItemSeen(current: LifecycleStatus): MissingTransition {
  // Reappearance always wins: if Google is showing it again, it exists again.
  if (current === 'ARCHIVED') return { status: 'ARCHIVED', missingStreak: 0 };
  return { status: 'ACTIVE', missingStreak: 0 };
}

export function onItemMissing(
  current: LifecycleStatus,
  missingStreak: number,
  completeness: ListingCompleteness,
): MissingTransition {
  // Absence from an incomplete or failed listing carries no information at all.
  if (completeness !== 'COMPLETE') return { status: current, missingStreak };
  if (current === 'ARCHIVED') return { status: 'ARCHIVED', missingStreak };

  const nextStreak = missingStreak + 1;
  return {
    status: nextStreak >= MISSING_STREAK_THRESHOLD ? 'SOURCE_REMOVED' : 'SOURCE_MISSING',
    missingStreak: nextStreak,
  };
}

/** Statuses that belong in a student's working list of coursework. */
export const VISIBLE_LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  'ACTIVE',
  'SOURCE_MISSING',
];

export function isVisibleLifecycle(status: LifecycleStatus): boolean {
  return VISIBLE_LIFECYCLE_STATUSES.includes(status);
}
